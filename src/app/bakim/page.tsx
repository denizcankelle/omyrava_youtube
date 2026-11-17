import { getConfig } from "@/lib/config";
import { dirSize, freeBytes, listBackups } from "@/lib/maintenance";
import { MaintenanceButtons } from "../MaintenanceButtons";

export const dynamic = "force-dynamic";

const gb = (n: number | null) => (n === null ? "?" : `${(n / 1024 ** 3).toFixed(2)} GB`);

export default function MaintenancePage() {
  const cfg = getConfig();
  const backups = listBackups(cfg.dataDir);
  const rows: [string, string][] = [
    ["Üretilen videolar (output)", gb(dirSize(cfg.outputDir))],
    ["Ses ve görüntü varlıkları (data/assets)", gb(dirSize(`${cfg.dataDir}/assets`))],
    [
      "Ara dosyalar (data/work + renders)",
      gb(dirSize(`${cfg.dataDir}/work`) + dirSize(`${cfg.dataDir}/renders`)),
    ],
    ["Veritabanı yedekleri", gb(backups.reduce((a, b) => a + b.size, 0))],
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
