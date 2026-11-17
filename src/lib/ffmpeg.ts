import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { JobError } from "./jobs";

type Env = Record<string, string | undefined>;

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/**
 * FFmpeg'in olasi konumlari, oncelik sirasiyla: PATH, sonra Windows'ta winget / elle kurulum
 * / Chocolatey / Scoop klasorleri. PATH yenilenmemis olsa bile FFmpeg bulunabilsin diye.
 */
export function ffmpegCandidates(
  platform: string = process.platform,
  env: Env = process.env,
): string[] {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const exe = win ? "ffmpeg.exe" : "ffmpeg";
  const out: string[] = [];
  const pathVar = env.PATH ?? env.Path ?? "";
  for (const dir of pathVar.split(win ? ";" : ":")) {
    const d = dir.trim().replace(/^"(.*)"$/, "$1");
    if (d) out.push(p.join(d, exe));
  }
  if (win) {
    const local = env.LOCALAPPDATA;
    if (local) {
      out.push(p.join(local, "Microsoft", "WinGet", "Links", exe));
      const pkgs = p.join(local, "Microsoft", "WinGet", "Packages");
      for (const pkg of listDirs(pkgs).filter((d) =>
        /gyan\.ffmpeg|ffmpeg/i.test(path.basename(d)),
      )) {
        for (const inner of listDirs(pkg)) out.push(p.join(inner, "bin", exe));
        out.push(p.join(pkg, "bin", exe));
      }
    }
    for (const pf of [env.ProgramFiles, env["ProgramFiles(x86)"]]) {
      if (pf) out.push(p.join(pf, "ffmpeg", "bin", exe), p.join(pf, "FFmpeg", "bin", exe));
    }
    out.push("C:\\ffmpeg\\bin\\ffmpeg.exe", "D:\\ffmpeg\\bin\\ffmpeg.exe");
    if (env.ChocolateyInstall) out.push(p.join(env.ChocolateyInstall, "bin", exe));
    if (env.USERPROFILE) out.push(p.join(env.USERPROFILE, "scoop", "shims", exe));
  } else {
    out.push("/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg");
  }
  return [...new Set(out)];
}

/** FFMPEG_PATH ayarliysa onu, degilse bilinen konumlarda bulunan ilk ffmpeg'i dondurur. */
export function findFfmpeg(configured: string | null, env: Env = process.env): string | null {
  if (configured) return isFile(configured) ? configured : null;
  return ffmpegCandidates(process.platform, env).find(isFile) ?? null;
}

export function resolveFfmpegPath(configured: string | null): string {
  const found = findFfmpeg(configured);
  if (found) return found;
  throw new JobError(
    "FFMPEG_NOT_FOUND",
    configured
      ? `FFMPEG_PATH ile verilen dosya yok: ${configured}`
      : "FFmpeg bulunamadı. KUR.bat'ı tekrar çalıştır veya .env dosyasında FFMPEG_PATH ayarla.",
    false,
  );
}

export interface RunFfmpegOptions {
  ffmpegPath: string;
  args: string[];
  /** Beklenen cikti suresi (sn); ilerleme hesabi icin. */
  expectedDurationSec?: number;
  onProgress?: (fraction: number) => void;
  shouldCancel?: () => boolean;
  /** stderr'den saklanacak en fazla karakter (analiz icin buyutulur). */
  stderrLimit?: number;
  /** Calisma klasoru. */
  cwd?: string;
}

/** FFmpeg'i calistirir; -progress ciktisindan ilerleme okur. stderr son satirlarini dondurur. */
export function runFfmpeg(opts: RunFfmpegOptions): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-nostdin", "-progress", "pipe:1", ...opts.args];
    const child = spawn(opts.ffmpegPath, args, { windowsHide: true, cwd: opts.cwd });
    let stderr = "";
    let buf = "";
    let lastReport = 0;
    const cancelTimer = setInterval(() => {
      if (opts.shouldCancel?.()) child.kill("SIGKILL");
    }, 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && opts.expectedDurationSec && opts.onProgress) {
          const sec = Number(m[1]) / 1_000_000;
          const now = Date.now();
          if (now - lastReport > 500) {
            lastReport = now;
            opts.onProgress(Math.min(0.99, sec / opts.expectedDurationSec));
          }
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-(opts.stderrLimit ?? 8000));
    });
    child.on("error", (err) => {
      clearInterval(cancelTimer);
      reject(new JobError("FFMPEG_SPAWN", `FFmpeg baslatilamadi: ${err.message}`, false));
    });
    child.on("close", (code) => {
      clearInterval(cancelTimer);
      if (opts.shouldCancel?.()) return reject(new JobError("CANCELLED", "Is iptal edildi", false));
      if (code === 0) resolve({ stderr });
      else
        reject(
          new JobError(
            "FFMPEG_EXIT",
            `FFmpeg cikis kodu ${code}: ${stderr.split("\n").slice(-5).join(" | ")}`,
          ),
        );
    });
  });
}

/** `ffmpeg -i dosya` ciktisindan sureyi okur (ffprobe gerektirmez). */
export async function probeDurationSec(ffmpegPath: string, file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], { windowsHide: true });
    let err = "";
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(parseDuration(err)));
  });
}

export function parseDuration(ffmpegOutput: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffmpegOutput);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
