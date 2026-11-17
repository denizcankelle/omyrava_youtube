import fs from "node:fs";
import path from "node:path";

let envLoaded = false;

/** Next.js .env dosyasini kendisi okur; worker ve scriptler icin burada yuklenir. */
function loadEnvOnce() {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

export function getConfig() {
  loadEnvOnce();
  const root = process.cwd();
  const dataDir = path.resolve(/*turbopackIgnore: true*/ root, process.env.DATA_DIR || "./data");
  return {
    dataDir,
    dbPath: path.join(dataDir, "omyrava.db"),
    outputDir: path.resolve(/*turbopackIgnore: true*/ root, process.env.OUTPUT_DIR || "./output"),
    migrationsDir: path.resolve(/*turbopackIgnore: true*/ root, "migrations"),
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || null,
    aiDir: path.resolve(/*turbopackIgnore: true*/ root, "ai"),
    aiPython:
      process.env.AI_PYTHON?.trim() ||
      path.resolve(
        /*turbopackIgnore: true*/ root,
        process.platform === "win32" ? "ai/.venv/Scripts/python.exe" : "ai/.venv/bin/python",
      ),
    imagePython:
      process.env.IMAGE_PYTHON?.trim() ||
      path.resolve(
        /*turbopackIgnore: true*/ root,
        process.platform === "win32"
          ? "ai/.venv-img/Scripts/python.exe"
          : "ai/.venv-img/bin/python",
      ),
    soundfontPath: path.resolve(
      /*turbopackIgnore: true*/ root,
      process.env.SOUNDFONT_PATH || "./soundfonts/FluidR3_GM.sf2",
    ),
    workerPollMs: Number(process.env.WORKER_POLL_MS) || 2000,
    workerConcurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1),
  };
}
