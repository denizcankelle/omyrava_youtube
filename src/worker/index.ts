import { getConfig } from "../lib/config";
import { openDatabase } from "../lib/db";
import {
  type Job,
  JobError,
  claimNextJob,
  completeJob,
  failJob,
  isCancelled,
  logJob,
  recoverStaleJobs,
} from "../lib/jobs";
import { handlers } from "./handlers";
import { writeHeartbeat } from "../lib/heartbeat";
import { autoBackup, cleanup } from "../lib/maintenance";

const once = process.argv.includes("--once");
const cfg = getConfig();
const db = openDatabase(cfg.dbPath, cfg.migrationsDir);

let stopping = false;
let active = 0;

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

async function runJob(job: Job) {
  active++;
  log(`Basladi: ${job.type} ${job.id} (deneme ${job.attempts}/${job.max_attempts})`);
  logJob(db, job.id, "info", `Deneme ${job.attempts} basladi`);
  try {
    const handler = handlers[job.type];
    if (!handler) throw new JobError("UNKNOWN_JOB_TYPE", `Bilinmeyen is tipi: ${job.type}`, false);
    const result = await handler({
      db,
      job,
      outputDir: cfg.outputDir,
      dataDir: cfg.dataDir,
      ffmpegPathSetting: cfg.ffmpegPath,
    });
    if (isCancelled(db, job.id)) {
      log(`Iptal edildi: ${job.id}`);
    } else {
      completeJob(db, job.id, result);
      log(`Tamamlandi: ${job.id}`);
    }
  } catch (err) {
    if (isCancelled(db, job.id)) {
      log(`Iptal edildi: ${job.id}`);
    } else {
      const outcome = failJob(db, job, err);
      log(`Hata (${outcome}): ${job.id} ${(err as Error).message}`);
    }
  } finally {
    active--;
  }
}

async function main() {
  // Tek worker varsayimi: baslangicta 'running' kalan isler onceki calismadan artiktir.
  const recovered = recoverStaleJobs(db, 0);
  if (recovered) log(`${recovered} yarim kalan is tekrar kuyruga alindi`);
  log(`Hazir. Veritabani: ${cfg.dbPath} | Cikti: ${cfg.outputDir}${once ? " | --once" : ""}`);
  let lastMaintenance = 0;

  while (!stopping) {
    writeHeartbeat(cfg.dataDir, active);
    // Gunluk bakim: yedek + eski ara dosyalar (bos zamanda)
    if (!once && active === 0 && Date.now() - lastMaintenance > 6 * 3600 * 1000) {
      lastMaintenance = Date.now();
      try {
        const b = autoBackup(db, cfg.dataDir);
        if (b) log(`Yedek alindi: ${b}`);
        const c = cleanup(db, cfg.dataDir);
        if (c.removed) log(`Temizlik: ${c.removed} klasor, ${(c.bytes / 1024 ** 2).toFixed(0)} MB`);
      } catch (err) {
        log(`Bakim hatasi: ${(err as Error).message}`);
      }
    }
    let picked = false;
    while (active < cfg.workerConcurrency) {
      const job = claimNextJob(db);
      if (!job) break;
      picked = true;
      void runJob(job);
    }
    if (once && !picked && active === 0) {
      const pending = db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')")
        .get() as { n: number };
      if (Number(pending.n) === 0) break;
    }
    await new Promise((r) => setTimeout(r, once ? 200 : cfg.workerPollMs));
  }
  while (active > 0) await new Promise((r) => setTimeout(r, 200));
  db.close();
  log("Durdu.");
}

// Beklenmeyen hatalar worker'i durdurmasin: kaydet ve devam et.
process.on("unhandledRejection", (reason) => {
  log(
    `Beklenmeyen hata (devam ediliyor): ${reason instanceof Error ? reason.message : String(reason)}`,
  );
});
process.on("uncaughtException", (err) => {
  log(`Beklenmeyen hata (devam ediliyor): ${err.message}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`${sig} alindi, aktif isler bitince kapanacak...`);
    stopping = true;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
