import Link from "next/link";
import type { DB } from "@/lib/db";
import type { Project } from "@/lib/projects";
import { listStats } from "@/lib/stats";
import { StatsForm } from "./StatsForm";

/** Yuklenmis videolar icin: YouTube Studio rakamlarini elle girme. */
export function StatsSection({ db, project }: { db: DB; project: Project }) {
  if (!["uploaded", "scheduled", "published"].includes(project.status)) return null;
  const stats = listStats(db, project.id);
  return (
    <section className="card full">
      <h2>İstatistik (YouTube Studio&apos;dan)</h2>
      <p className="muted">
        Videoyu yükledikten 7 ve 28 gün sonra YouTube Studio › Analiz ekranındaki rakamları gir. Tüm
        videoların özeti ve öneriler <Link href="/istatistik">Kanal panosu</Link> sayfasında.
      </p>
      <div className="two">
        <StatsForm projectId={project.id} />
        <div>
          {stats.length === 0 ? (
            <p className="muted">Henüz kayıt yok.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Görüntülenme</th>
                  <th>Saat</th>
                  <th>Ort. izleme</th>
                  <th>TO</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.id}>
                    <td>{s.recorded_at.slice(0, 10)}</td>
                    <td>{s.views.toLocaleString("tr-TR")}</td>
                    <td>{s.watch_hours ?? "-"}</td>
                    <td>
                      {s.avg_view_sec !== null ? `${(s.avg_view_sec / 60).toFixed(1)} dk` : "-"}
                    </td>
                    <td>{s.ctr !== null ? `%${s.ctr}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
