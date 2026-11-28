import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";
import {
  assetDir,
  licenseSchema,
  registerDerivedAsset,
  updateAssetMeta,
  upsertLicense,
} from "../lib/assets";
import { getConfig } from "../lib/config";
import {
  GENERALUSER_FILE,
  MUSIC_STYLES,
  type MusicEvent,
  type MusicStyle,
  STYLE_BANK,
  composeMusic,
} from "../lib/composer";
import { resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { JobError, isCancelled, logJob, updateProgress } from "../lib/jobs";
import { getProject } from "../lib/projects";
import { REVERB_PROFILES, STYLE_REVERB, irArgs, reverbArgs } from "../lib/reverb";
import { gainToTarget } from "../lib/synth";
import { comfortClass, comfortSummary } from "../lib/comfort";
import { type JobHandler, analyzeAudioFile, measureComfort, solveComfort } from "./handlers";

const SR = 48000;
let bankCache: { path: string; bank: ReturnType<typeof SoundBankLoader.fromArrayBuffer> } | null =
  null;

function loadBank(file: string) {
  if (bankCache?.path === file) return bankCache.bank;
  if (!fs.existsSync(file))
    throw new JobError(
      "SOUNDFONT_MISSING",
      `Enstrüman dosyası (SoundFont) bulunamadı: ${file}. KUR.bat'ı yeniden çalıştır.`,
      false,
    );
  const buf = fs.readFileSync(file);
  const bank = SoundBankLoader.fromArrayBuffer(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  bankCache = { path: file, bank };
  return bank;
}

function apply(synth: SpessaSynthProcessor, e: MusicEvent) {
  switch (e.type) {
    case "program":
      synth.programChange(e.ch, e.program);
      break;
    case "cc":
      synth.controllerChange(e.ch, e.cc as never, e.value);
      break;
    case "on":
      synth.noteOn(e.ch, e.note, e.vel);
      break;
    case "off":
      synth.noteOff(e.ch, e.note);
      break;
    case "bend":
      synth.pitchWheel(e.ch, e.value);
      break;
  }
}

/** Notalari SoundFont ile calar, ham ornekleri FFmpeg'e akitarak FLAC yazar (bellege almaz). */
async function renderToFlac(opts: {
  ffmpeg: string;
  soundfont: string;
  events: MusicEvent[];
  durationSec: number;
  output: string;
  onProgress: (f: number) => void;
  shouldCancel: () => boolean;
}) {
  const synth = new SpessaSynthProcessor(SR);
  synth.soundBankManager.addSoundBank(loadBank(opts.soundfont), "main");
  await synth.ready;

  const child = spawn(
    opts.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "f32le",
      "-ar",
      String(SR),
      "-ac",
      "2",
      "-i",
      "pipe:0",
      "-c:a",
      "flac",
      opts.output,
    ],
    { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-4000)));
  let closed = false;
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      closed = true;
      if (code === 0) resolve();
      else reject(new JobError("FFMPEG_EXIT", `FFmpeg: ${stderr}`));
    });
  });
  // Iptal/hata durumunda reddedilen soz worker'i cokertmesin; stdin hatasi (EPIPE) da yutulur.
  done.catch(() => undefined);
  child.stdin.on("error", () => undefined);

  const total = Math.round(opts.durationSec * SR);
  const chunk = SR * 2;
  const block = 128;
  let ei = 0;
  for (let pos = 0; pos < total; pos += chunk) {
    if (opts.shouldCancel() || closed) {
      child.kill("SIGKILL");
      await done.catch(() => undefined);
      if (opts.shouldCancel()) throw new JobError("CANCELLED", "İş iptal edildi", false);
      await done; // FFmpeg erken kapandiysa gercek hatayi firlat
    }
    const n = Math.min(chunk, total - pos);
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i += block) {
      const tsec = (pos + i) / SR;
      while (ei < opts.events.length && opts.events[ei].t <= tsec) apply(synth, opts.events[ei++]);
      synth.process(L, R, i, Math.min(block, n - i));
    }
    const inter = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      inter[2 * i] = L[i];
      inter[2 * i + 1] = R[i];
    }
    const ok = child.stdin.write(Buffer.from(inter.buffer));
    if (!ok)
      await new Promise<void>((res) => {
        const finish = () => {
          child.stdin.off("drain", finish);
          child.off("close", finish);
          res();
        };
        child.stdin.once("drain", finish);
        child.once("close", finish);
      });
    opts.onProgress((pos + n) / total);
  }
  child.stdin.end();
  await done;
}

/** Besteci: stil + seed -> nota olaylari -> SoundFont ile calma -> -18 LUFS FLAC varlik. */
export const musicCompose: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const p = JSON.parse(job.payload) as {
    projectId: string;
    style: MusicStyle;
    minutes: number;
    seed: number;
  };
  if (!(p.style in MUSIC_STYLES)) throw new JobError("BAD_STYLE", "Geçersiz müzik türü", false);
  const project = getProject(db, p.projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  const baseFont = ctx.soundfontPath ?? getConfig().soundfontPath;
  // Stile gore daha kaliteli banka (varsa)
  const gu = path.join(path.dirname(baseFont), GENERALUSER_FILE);
  const soundfont = STYLE_BANK[p.style] === "generaluser" && fs.existsSync(gu) ? gu : baseFont;
  const bankName = soundfont === gu ? "GeneralUser GS (ticari müziğe izinli)" : "FluidR3_GM (MIT)";
  const durationSec = Math.round(p.minutes * 60);
  const work = path.join(
    ctx.dataDir ?? ctx.outputDir,
    "work",
    `mus-${job.id.slice(0, 8)}-${p.seed}`,
  );
  fs.mkdirSync(work, { recursive: true });
  try {
    const comp = composeMusic(p.style, p.seed, durationSec);
    logJob(db, job.id, "info", `${comp.description} · enstrümanlar: ${bankName}`);
    const raw = path.join(work, "raw.flac");
    updateProgress(db, job.id, 0.02, "çalınıyor");
    await renderToFlac({
      ffmpeg,
      soundfont,
      events: comp.events,
      durationSec,
      output: raw,
      shouldCancel: () => isCancelled(db, job.id),
      onProgress: (f) => updateProgress(db, job.id, 0.02 + f * 0.6, "çalınıyor"),
    });

    // Mekan yankisi (konvolusyon): bazi stillerde kuru SoundFont sesine gercek mekan hissi
    let mastered = raw;
    const rv = STYLE_REVERB[p.style];
    if (rv) {
      const ir = path.join(work, `ir-${rv}.wav`);
      await runFfmpeg({ ffmpegPath: ffmpeg, args: irArgs(rv, ir) });
      mastered = path.join(work, "reverb.flac");
      updateProgress(db, job.id, 0.62, "mekân yankısı");
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args: reverbArgs(raw, ir, mastered, rv),
        expectedDurationSec: durationSec,
        shouldCancel: () => isCancelled(db, job.id),
        onProgress: (f) => updateProgress(db, job.id, 0.62 + f * 0.1, "mekân yankısı"),
      });
      logJob(db, job.id, "info", `Mekân yankısı: ${REVERB_PROFILES[rv].label}`);
    }
    // Rahatlik: sert/tiz bolge sinirin ustundeyse seviye olcumunden ONCE yumusatilir
    const cls = comfortClass(p.style);
    const { first: cm, fix } = await solveComfort(ffmpeg, mastered, cls);
    if (cm && fix.length) {
      logJob(db, job.id, "info", `Yumuşatılıyor: ${comfortSummary(cm)}`);
      const soft = path.join(work, "soft.flac");
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args: ["-y", "-i", mastered, "-af", fix.join(","), "-c:a", "flac", soft],
        shouldCancel: () => isCancelled(db, job.id),
      });
      mastered = soft;
    }
    const measured = await analyzeAudioFile(ctx, ffmpeg, mastered, [0.72, 0.8]);
    if (!measured.loudness) throw new JobError("MEASURE_FAILED", "Üretilen müzik ölçülemedi");
    const gain = gainToTarget(measured.loudness.input_i, measured.loudness.input_tp);
    const dir = assetDir(ctx.dataDir ?? ctx.outputDir, project.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `music-${p.style}-${p.seed}.flac`);
    updateProgress(db, job.id, 0.8, "seviye");
    await runFfmpeg({
      ffmpegPath: ffmpeg,
      args: ["-y", "-i", mastered, "-af", `volume=${gain}dB`, "-c:a", "flac", dest],
      expectedDurationSec: durationSec,
      shouldCancel: () => isCancelled(db, job.id),
      onProgress: (f) => updateProgress(db, job.id, 0.8 + f * 0.1),
    });
    const asset = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: dest,
      type: "audio",
      parentAssetId: null,
      source: `music:${p.style}:${p.seed}`,
      originalName: `${MUSIC_STYLES[p.style].label} · ${p.minutes} dk · #${p.seed}`,
    });
    upsertLicense(
      db,
      asset.id,
      licenseSchema.parse({
        provider: "Omyrava Studio — algoritmik beste (yapay zekâ yok)",
        licenseType: `Kendi bestem; enstrüman sesleri ${bankName} SoundFont`,
        notes: `Otomatik kayıt. ${comp.description}. Seed ${p.seed}.`,
        reviewed: true,
      }),
    );
    const after = await analyzeAudioFile(ctx, ffmpeg, dest, [0.9, 0.99]);
    const comfort = await measureComfort(ffmpeg, dest, cls);
    if (comfort) after.comfort = comfort;
    updateAssetMeta(db, asset.id, { durationSec: after.durationSec, analysis: after });
    logJob(db, job.id, "info", `Hazır: ${asset.original_name}`);
    return { assetId: asset.id, gainDb: gain };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
