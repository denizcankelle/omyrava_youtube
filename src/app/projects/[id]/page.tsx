import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getJobLogs, listJobs } from "@/lib/jobs";
import { CATEGORIES, approvalBlockers, formatDuration, getProject } from "@/lib/projects";
import { STATUS_LABELS, allowedNext } from "@/lib/status";
import { cancelJobAction, setStatusAction } from "../../actions";
import { AutoRefresh } from "../../AutoRefresh";
import { AssetsSection } from "../../AssetsSection";
import { RenderSection } from "../../RenderSection";
import { PublishSection } from "../../PublishSection";
import { AutoSection } from "../../AutoSection";
import { StatsSection } from "../../StatsSection";
import { SoundStudioSection } from "../../SoundStudioSection";

export const dynamic = "force-dynamic";

const JOB_TYPE_LABELS: Record<string, string> = {
  sample_render: "Örnek render",
  asset_analyze: "Varlık analizi",
  audio_normalize: "Ses normalizasyonu",
  render_video: "Video render",
  thumbnail_generate: "Kapak üretimi",
  visual_generate: "Görüntü üretimi",
  music_compose: "Müzik besteleme",
  ai_music: "Yapay zekâ müziği",
  ai_visual: "Yapay zekâ görseli",
  auto_produce: "Otomatik hazırlık",
  auto_finalize: "Tam render + paket",
  audio_generate: "Ses üretimi",
  audio_mix: "Ses karışımı",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Kuyrukta",
  running: "Çalışıyor",
  succeeded: "Tamamlandı",
  failed: "Hata",
  cancelled: "İptal",
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const db = getDb();
  const project = getProject(db, id);
  if (!project) notFound();
  const jobs = listJobs(db, { projectId: id, limit: 20 });
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  const blockers = ["ready", "reviewing", "rendering", "qa_failed"].includes(project.status)
    ? approvalBlockers(db, id)
    : [];

  return (
    <div className="grid">
      <AutoRefresh active={active} />
      {error && <div className="alert full">{error}</div>}
      <section className="card">
        <h2>{project.title}</h2>
        <dl className="meta">
          <dt>Durum</dt>
          <dd>
            <span className={`badge ${project.status}`}>{STATUS_LABELS[project.status]}</span>
          </dd>
          <dt>Kategori</dt>
          <dd>{CATEGORIES[project.category]}</dd>
          <dt>Süre</dt>
          <dd>{formatDuration(project.duration_sec)}</dd>
          <dt>Çözünürlük</dt>
          <dd>{project.resolution}</dd>
          <dt>Hedef tarih</dt>
          <dd>{project.target_date ?? "-"}</dd>
          <dt>Notlar</dt>
          <dd>{project.notes ?? "-"}</dd>
        </dl>
        <h2 style={{ marginTop: 20 }}>Durum değiştir</h2>
        <div className="row-actions">
          {allowedNext(project.status).length === 0 && <span className="muted">Son durum.</span>}
          {allowedNext(project.status).map((to) => (
            <form key={to} action={setStatusAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="to" value={to} />
              <button type="submit" className={to === "cancelled" ? "danger" : "ghost"}>
                {STATUS_LABELS[to]}
              </button>
            </form>
          ))}
        </div>
        {blockers.length > 0 && (
          <div className="notice">Yayın onayı için eksikler: {blockers.join("; ")}</div>
        )}
      </section>

      <section className="card">
        <h2>İşler</h2>
        <p className="muted" style={{ margin: 0 }}>
          Arka planda çalışan işler. Worker kapalıysa işler sırada bekler.
        </p>
        {jobs.length === 0 ? (
          <p className="empty">Bu proje için iş yok.</p>
        ) : (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>İş</th>
                <th>Durum</th>
                <th>İlerleme</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const logs = getJobLogs(db, j.id).slice(-4);
                const result = j.result
                  ? (JSON.parse(j.result) as { outputPath?: string } | null)
                  : null;
                return (
                  <tr key={j.id}>
                    <td>
                      {JOB_TYPE_LABELS[j.type] ?? j.type}
                      <div className="muted">
                        deneme {j.attempts}/{j.max_attempts} ·{" "}
                        {j.created_at.slice(0, 19).replace("T", " ")}
                      </div>
                      {result?.outputPath && (
                        <div>
                          <code>{result.outputPath}</code>
                        </div>
                      )}
                      {j.error_message && (
                        <div className="error">
                          {j.error_code}: {j.error_message}
                        </div>
                      )}
                      {logs.length > 0 && (
                        <pre className="logs">
                          {logs.map((l) => `[${l.level}] ${l.message}`).join("\n")}
                        </pre>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${j.status}`}>{JOB_STATUS_LABELS[j.status]}</span>
                    </td>
                    <td>
                      <div className="bar">
                        <div style={{ width: `${Math.round(j.progress * 100)}%` }} />
                      </div>
                      <div className="muted">
                        {Math.round(j.progress * 100)}%{j.step ? ` · ${j.step}` : ""}
                      </div>
                    </td>
                    <td>
                      {(j.status === "queued" || j.status === "running") && (
                        <form action={cancelJobAction}>
                          <input type="hidden" name="jobId" value={j.id} />
                          <input type="hidden" name="projectId" value={project.id} />
                          <button type="submit" className="danger" style={{ marginTop: 0 }}>
                            Iptal
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <AutoSection db={db} project={project} />
      <StatsSection db={db} project={project} />
      <details className="advanced full">
        <summary>Gelişmiş: elle üretim, render, yayın paketi ve dosyalar</summary>
        <div className="grid">
          <SoundStudioSection db={db} projectId={project.id} />
          <RenderSection db={db} projectId={project.id} durationSec={project.duration_sec} />
          <PublishSection db={db} project={project} />
          <AssetsSection db={db} projectId={project.id} />
        </div>
      </details>
    </div>
  );
}
