import type { DB } from "@/lib/db";
import { ASSET_TYPE_LABELS, formatBytes, formatClock, listAssets } from "@/lib/assets";
import { formatDuration } from "@/lib/projects";
import type { QaIssue } from "@/lib/render";
import { RenderForm } from "./RenderForm";

interface RenderRow {
  id: string;
  profile: string;
  output_path: string;
  status: string;
  duration_sec: number | null;
  size_bytes: number | null;
  qa_status: string;
  qa_notes: string | null;
  warnings: string | null;
  created_at: string;
}

const STATUS: Record<string, string> = {
  running: "Çalışıyor",
  done: "Hazır",
  failed: "Hata",
  cancelled: "İptal",
};

export function RenderSection({
  db,
  projectId,
  durationSec,
}: {
  db: DB;
  projectId: string;
  durationSec: number;
}) {
  const assets = listAssets(db, projectId);
  const audios = assets
    .filter((a) => a.type === "audio")
    // normalize edilmis sesler once
    .sort((a, b) => Number(Boolean(b.parent_asset_id)) - Number(Boolean(a.parent_asset_id)))
    .map((a) => ({
      id: a.id,
      kind: a.type,
      label: `${a.original_name ?? a.id}${a.duration_sec ? ` · ${formatClock(a.duration_sec)}` : ""}`,
    }));
  const visuals = assets
    .filter((a) => a.type === "video_loop" || a.type === "image" || a.type === "thumbnail")
    .sort((a, b) => Number(b.type === "video_loop") - Number(a.type === "video_loop"))
    .map((a) => ({
      id: a.id,
      kind: a.type,
      label: `${ASSET_TYPE_LABELS[a.type]}: ${a.original_name ?? a.id}`,
    }));
  const renders = db
    .prepare(
      `SELECT r.* FROM renders r WHERE r.project_id = ? AND r.profile != 'sample_1080p'
       ORDER BY r.created_at DESC LIMIT 20`,
    )
    .all(projectId) as unknown as RenderRow[];

  return (
    <section className="card full">
      <h2>Render</h2>
      <p className="muted">
        Görüntü kısa bir döngü olarak bir kez kodlanır, sonra yeniden kodlanmadan hedef süreye
        uzatılır; ses tam süreye bir kez AAC olarak kodlanır. Önce 2 dakikalık önizleme ile kontrol
        et, sonra tam render al.
      </p>
      <RenderForm
        projectId={projectId}
        audios={audios}
        visuals={visuals}
        durationLabel={formatDuration(durationSec)}
      />
      {renders.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {renders.map((r) => {
            const warnings = r.warnings ? (JSON.parse(r.warnings) as QaIssue[]) : [];
            return (
              <div key={r.id} className="asset">
                <div className="asset-head">
                  <span className="badge">{r.profile.startsWith("full") ? "Tam" : "Önizleme"}</span>
                  <span className={`badge ${r.status === "done" ? "passed" : r.status}`}>
                    {STATUS[r.status] ?? r.status}
                  </span>
                  <span className="muted">
                    {formatClock(r.duration_sec)} · {formatBytes(r.size_bytes)} ·{" "}
                    {r.created_at.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                <p>
                  <code>{r.output_path}</code>
                </p>
                {r.status === "done" && (
                  <video controls preload="none" src={`/api/renders/${r.id}/file`} />
                )}
                {r.qa_notes && <p className="error">{r.qa_notes}</p>}
                {warnings.length > 0 && (
                  <ul className="warn-list">
                    {warnings.map((w, i) => (
                      <li key={i} className={w.level}>
                        {w.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
