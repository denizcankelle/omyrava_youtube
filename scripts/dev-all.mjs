// Paneli ve worker'i tek komutla baslatir: npm run dev:all
// Worker beklenmedik sekilde kapanirsa otomatik yeniden baslatilir; panel kapanirsa hepsi kapanir.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const shell = process.platform === "win32";
let stopping = false;
let worker = null;
let restarts = 0;

function startWorker() {
  worker = spawn(npm, ["run", "worker"], { stdio: "inherit", shell });
  worker.on("exit", (code) => {
    if (stopping) return;
    restarts++;
    console.log(`[worker] kapandi (${code}); ${restarts}. kez yeniden baslatiliyor...`);
    setTimeout(startWorker, Math.min(30000, 2000 * restarts));
  });
}

const web = spawn(npm, ["run", "dev"], { stdio: "inherit", shell });
web.on("exit", (code) => {
  console.log(`[web] kapandi (${code})`);
  stopping = true;
  if (worker && !worker.killed) worker.kill();
  process.exit(code ?? 0);
});
startWorker();

process.on("SIGINT", () => {
  stopping = true;
  web.kill("SIGINT");
  if (worker) worker.kill("SIGINT");
});
