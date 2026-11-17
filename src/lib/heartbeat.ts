import fs from "node:fs";
import path from "node:path";

/** Worker'in calistigini panele bildiren kucuk dosya (data/worker.json). */
export function heartbeatPath(dataDir: string) {
  return path.join(dataDir, "worker.json");
}

let last = 0;
export function writeHeartbeat(dataDir: string, active: number) {
  const now = Date.now();
  if (now - last < 3000) return;
  last = now;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(heartbeatPath(dataDir), JSON.stringify({ pid: process.pid, at: now, active }));
  } catch {
    // panel bilgisi; hata onemsiz
  }
}

/** Son sinyalden bu yana gecen sure (ms); dosya yoksa null. */
export function heartbeatAge(dataDir: string): number | null {
  try {
    const hb = JSON.parse(fs.readFileSync(heartbeatPath(dataDir), "utf8")) as { at: number };
    return Date.now() - hb.at;
  } catch {
    return null;
  }
}
