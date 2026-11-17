import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAsset,
  importAssetFromPath,
  licenseSchema,
  listAssets,
  upsertLicense,
} from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob } from "../src/lib/jobs";
import { suggestMetadata } from "../src/lib/metadata";
import {
  ApprovalBlockedError,
  approvalBlockers,
  createProject,
  createProjectSchema,
  getProject,
  setProjectStatus,
} from "../src/lib/projects";
import {
  PublishError,
  exportPackage,
  getPublication,
  recordUpload,
  saveMetadata,
} from "../src/lib/publish";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const gen = (args: string[]) =>
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]);

describe("yayin paketi uctan uca (FFmpeg ile)", () => {
  it("render -> kapak -> metaveri -> paket -> onay -> YouTube kaydi", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-pub-"));
    const wav = path.join(dir, "ses.wav");
    const png = path.join(dir, "gece.png");
    gen(["-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.2:d=30:r=48000", "-ac", "2", wav]);
    gen(["-f", "lavfi", "-i", "gradients=s=1920x1080:d=1", "-frames:v", "1", png]);

    const db = memoryDb();
    const dataDir = path.join(dir, "data");
    const outputDir = path.join(dir, "output");
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Yayın Test", category: "rain", durationHours: 1 }),
    );
    db.prepare("UPDATE projects SET duration_sec = 45 WHERE id = ?").run(p.id);
    const audio = await importAssetFromPath(db, dataDir, { projectId: p.id, sourcePath: wav });
    const image = await importAssetFromPath(db, dataDir, { projectId: p.id, sourcePath: png });
    for (const a of [audio, image])
      upsertLicense(db, a.id, licenseSchema.parse({ provider: "Kendi üretimim", reviewed: "on" }));

    const run = async () => {
      const job = claimNextJob(db)!;
      const r = await handlers[job.type]({
        db,
        job,
        outputDir,
        dataDir,
        ffmpegPathSetting: process.env.FFMPEG_PATH || null,
      });
      completeJob(db, job.id, r);
      return r as Record<string, unknown>;
    };

    // paket render olmadan hazirlanamaz
    expect(() => exportPackage(db, outputDir, p.id)).toThrow(PublishError);

    enqueueJob(db, {
      type: "render_video",
      projectId: p.id,
      payload: {
        projectId: p.id,
        audioAssetId: audio.id,
        visualAssetId: image.id,
        mode: "full",
        motion: "none",
      },
    });
    await run();
    expect(getProject(db, p.id)!.status).toBe("ready");

    enqueueJob(db, {
      type: "thumbnail_generate",
      projectId: p.id,
      payload: { assetId: image.id, text: "8 SAAT\nYağmur Sesi" },
    });
    const t = await run();
    const thumb = getAsset(db, t.assetId as string)!;
    expect(thumb.type).toBe("thumbnail");
    expect(thumb.parent_asset_id).toBe(image.id);
    const info = execFileSync(ffmpeg, ["-hide_banner", "-i", thumb.file_path, "-f", "null", "-"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(info).toBeDefined();
    expect(fs.statSync(thumb.file_path).size).toBeLessThan(2 * 1024 * 1024);

    const d = suggestMetadata({
      category: "rain",
      durationSec: 3600 * 8,
      scene: "Night Window",
      lang: "en",
      aiGenerated: true,
    });
    saveMetadata(db, p.id, {
      language: "en",
      title: d.title,
      description: d.description,
      tags: d.tags,
      aiGenerated: true,
    });

    // onaydan once YouTube kaydi yapilamaz
    expect(() => recordUpload(db, p.id, { video: "dQw4w9WgXcQ", privacy: "private" })).toThrow(
      PublishError,
    );

    const pkg = exportPackage(db, outputDir, p.id);
    const txt = fs.readFileSync(path.join(pkg.dir, "baslik-aciklama.txt"), "utf8");
    expect(txt).toContain(d.title);
    expect(txt).toContain("sentetik içerik");
    expect(fs.readFileSync(path.join(pkg.dir, "lisanslar.txt"), "utf8")).toContain(
      "Kendi üretimim",
    );
    expect(fs.existsSync(path.join(pkg.dir, "kapak.jpg"))).toBe(true);

    expect(approvalBlockers(db, p.id)).toEqual([]);
    setProjectStatus(db, p.id, "approved");
    expect(() => setProjectStatus(db, p.id, "uploaded")).toThrow(ApprovalBlockedError);

    const later = new Date(Date.now() + 86_400_000).toISOString();
    const pub = recordUpload(db, p.id, {
      video: "https://youtu.be/dQw4w9WgXcQ",
      privacy: "private",
      scheduledAt: later,
    });
    expect(pub.youtube_video_id).toBe("dQw4w9WgXcQ");
    expect(pub.status).toBe("scheduled");
    expect(getProject(db, p.id)!.status).toBe("scheduled");

    recordUpload(db, p.id, { video: "dQw4w9WgXcQ", privacy: "public" });
    expect(getPublication(db, p.id)!.status).toBe("published");
    expect(getProject(db, p.id)!.status).toBe("published");
    expect(listAssets(db, p.id).length).toBe(3);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 180_000);
});
