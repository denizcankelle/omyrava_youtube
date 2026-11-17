import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAsset, getLicense } from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob } from "../src/lib/jobs";
import type { AudioAnalysis } from "../src/lib/media";
import { approvalBlockers, createProject, createProjectSchema } from "../src/lib/projects";
import { SYNTH_PRESETS, type SynthPreset } from "../src/lib/synth";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

describe("yerlesik ses uretimi ve karisim (FFmpeg ile)", () => {
  it("tum turleri uretir, seviyeyi ayarlar, lisansi otomatik kaydeder; karisim yapar", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-synth-"));
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Sentez", category: "cosmic", durationHours: 1 }),
    );
    const run = async () => {
      const job = claimNextJob(db)!;
      const r = await handlers[job.type]({
        db,
        job,
        outputDir: dir,
        dataDir: dir,
        ffmpegPathSetting: process.env.FFMPEG_PATH || null,
      });
      completeJob(db, job.id, r);
      return r as { assetId: string };
    };

    const ids: string[] = [];
    let seed = 111111;
    for (const preset of Object.keys(SYNTH_PRESETS) as SynthPreset[]) {
      enqueueJob(db, {
        type: "audio_generate",
        payload: { projectId: p.id, preset, minutes: 0.5, seed: seed++ },
      });
      const { assetId } = await run();
      const a = getAsset(db, assetId)!;
      const an = JSON.parse(a.analysis!) as AudioAnalysis;
      expect(a.duration_sec!, preset).toBeGreaterThan(29);
      expect(an.loudness!.input_tp, preset).toBeLessThan(-1.5);
      // hedef -18 LUFS; tepe siniri izin vermiyorsa daha sessiz olabilir
      expect(an.loudness!.input_i, preset).toBeLessThan(-17);
      expect(an.loudness!.input_i, preset).toBeGreaterThan(-30);
      expect(
        an.warnings.filter((w) => w.level === "error"),
        preset,
      ).toEqual([]);
      expect(getLicense(db, assetId)!.reviewed_at, preset).not.toBeNull();
      ids.push(assetId);
    }

    // drone + pad + drone sirali, altta yagmur
    enqueueJob(db, {
      type: "audio_mix",
      payload: {
        projectId: p.id,
        trackIds: [ids[5], ids[6], ids[5]],
        crossfadeSec: 5,
        bedId: ids[0],
        bedDb: -12,
        normalize: true,
      },
    });
    const { assetId } = await run();
    const mix = getAsset(db, assetId)!;
    expect(mix.duration_sec!).toBeGreaterThan(79);
    expect(mix.duration_sec!).toBeLessThan(81);
    expect(getLicense(db, assetId)!.notes).toContain("Kaynaklar");
    expect(approvalBlockers(db, p.id).join("|")).not.toMatch(/lisans/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 240_000);
});
