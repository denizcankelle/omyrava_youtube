import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { dirSize, freeBytes, listBackups, purgeUploaded } from "@/lib/maintenance";
import { MaintenanceButtons, PurgeButton } from "../MaintenanceButtons";

export const dynamic = "force-dynamic";

const gb = (n: number | null) => (n === null ? "?" : `${(n / 1024 ** 3).toFixed(2)} GB`);

function encoderLabel(dataDir: string): string {
  try {
    const e = JSON.parse(fs.readFileSync(path.join(dataDir, "encoder.json"), "utf8")) as {
      encoder: string;
    };
    return e.encoder === "nvenc" ? "NVIDIA ekran kartı (hızlı)" : "İşlemci (x264)";
  } catch {
    return "worker henüz başlamadı";
  }
}

export default function MaintenancePage() {
  const cfg = getConfig();
  const backups = listBackups(cfg.dataDir);
  const purge = purgeUploaded(getDb(), { dryRun: true });
  const autoDays = Number(process.env.AUTO_PURGE_DAYS) || 0;
  const rows: [string, string][] = [
    ["Üretilen videolar (output)", gb(dirSize(cfg.outputDir))],
    ["Ses ve görüntü varlıkları (data/assets)", gb(dirSize(`${cfg.dataDir}/assets`))],
    [
      "Ara dosyalar (data/work + renders)",
      gb(dirSize(`${cfg.dataDir}/work`) + dirSize(`${cfg.dataDir}/renders`)),
    ],
    ["Veritabanı yedekleri", gb(backups.reduce((a, b) => a + b.size, 0))],
    ["Video kodlayıcı", encoderLabel(cfg.dataDir)],
    ["Diskte boş alan", gb(freeBytes(cfg.outputDir) ?? freeBytes(cfg.dataDir))],
  ];
  return (
    <div className="grid">
      <section className="card full">
        <h2>Bakım</h2>
        <p className="muted">
          Worker her 6 saatte bir boş kaldığında son yedek 24 saatten eskiyse veritabanını yedekler
          (son 14 yedek tutulur) ve 6 saatten eski ara dosyaları siler. Videolara ve varlıklara
          dokunmaz. Buradan elle de çalıştırabilirsin.
        </p>
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <MaintenanceButtons />
        <h3 style={{ marginTop: 20 }}>Yüklenmiş videolar</h3>
        <p className="muted">
          YouTube&apos;a yüklediğin (bağlantısını kaydettiğin) projelerin tam videosu, önizlemesi,
          Shorts&apos;u ve ses/görüntü dosyaları silinebilir; kapaklar ve metinler kalır. Gerekirse
          proje yeniden üretilir.{" "}
          {autoDays > 0
            ? `Otomatik silme açık: yüklemeden ${autoDays} gün sonra.`
            : "Otomatik silmek için .env dosyasına AUTO_PURGE_DAYS=7 gibi bir satır ekle."}
        </p>
        {purge.projects.length === 0 ? (
          <p className="muted">Şu an silinebilecek dosya yok.</p>
        ) : (
          <ul>
            {purge.projects.map((p) => (
              <li key={p.id}>
                {p.title} · {gb(p.bytes)}
              </li>
            ))}
          </ul>
        )}
        <PurgeButton disabled={purge.projects.length === 0} />
        <h3 style={{ marginTop: 20 }}>Yedekler</h3>
        {backups.length === 0 ? (
          <p className="muted">Henüz yedek yok.</p>
        ) : (
          <ul>
            {backups.map((b) => (
              <li key={b.file}>
                <code>{b.file}</code> · {(b.size / 1024 ** 2).toFixed(1)} MB
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Geri yüklemek için: DURDUR.bat, sonra istediğin yedeği <code>data\omyrava.db</code> adıyla
          kopyala (eski <code>omyrava.db-wal</code> ve <code>-shm</code> dosyalarını sil),
          BASLAT.bat.
        </p>
      </section>
    </div>
  );
}
