import type { DB } from "@/lib/db";
import { formatClock, getAsset } from "@/lib/assets";
import type { Job } from "@/lib/jobs";
import type { Project } from "@/lib/projects";
import { getMetadata, getPublication } from "@/lib/publish";
import { STATUS_LABELS } from "@/lib/status";
import { autoFinalizeAction, autoProduceAction, setStatusAction } from "./actions";
import { RecordUploadForm } from "./PublishForms";

interface AutoResult {
  audioAssetId: string;
  visualAssetId: string;
  thumbnailAssetId: string;
  previewRenderId: string;
  notes: string[];
}

function lastJob(db: DB, projectId: string, type: string): Job | undefined {
  return db
    .prepare(
      "SELECT * FROM jobs WHERE project_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(projectId, type) as Job | undefined;
}

function Progress({ job, title }: { job: Job; title: string }) {
  return (
    <div>
      <p>
        <strong>{title}</strong>{" "}
        <span className="muted">
          {job.status === "queued" ? "sırada (worker çalışıyor olmalı)" : (job.step ?? "")}
        </span>
      </p>
      <div className="bar big">
        <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>
      <p className="muted">%{Math.round(job.progress * 100)}</p>
    </div>
  );
}

function StartButton({
  projectId,
  label,
  ghost,
}: {
  projectId: string;
  label: string;
  ghost?: boolean;
}) {
  return (
    <form action={autoProduceAction}>
      <input type="hidden" name="projectId" value={projectId} />
      <button type="submit" className={ghost ? "ghost" : undefined}>
        {label}
      </button>
    </form>
  );
}

export function AutoSection({ db, project }: { db: DB; project: Project }) {
  const produce = lastJob(db, project.id, "auto_produce");
  const finalize = lastJob(db, project.id, "auto_finalize");
  const active = (j?: Job) => j && (j.status === "queued" || j.status === "running");

  // 1) Hic baslamadi
  if (!produce) {
    return (
      <section className="card full auto">
        <h2>Otomatik üretim</h2>
        <p>
          Tek tuşla: kategoriye uygun sesler (birkaç farklı varyasyon + uzun karışım), hareketli
          görüntü, 2 dakikalık önizleme, 3 kapak ve YouTube başlığı/açıklaması hazırlanır. Yerel
          yapay zekâ kuruluysa müzik ve 4K sahne onunla, değilse yerleşik üreticilerle yapılır.
        </p>
        <StartButton projectId={project.id} label="Her şeyi otomatik hazırla" />
      </section>
    );
  }

  // 2) Hazirlaniyor
  if (active(produce)) {
    return (
      <section className="card full auto">
        <h2>Otomatik üretim</h2>
        <Progress job={produce} title="Hazırlanıyor" />
        <p className="muted">Bu sırada sayfayı kapatabilirsin; işlem arka planda sürer.</p>
      </section>
    );
  }

  // 3) Hata
  if (produce.status !== "succeeded" || !produce.result) {
    return (
      <section className="card full auto">
        <h2>Otomatik üretim</h2>
        <p className="error">
          Hazırlık tamamlanamadı{produce.error_message ? `: ${produce.error_message}` : ""}.
        </p>
        <StartButton projectId={project.id} label="Yeniden dene" />
      </section>
    );
  }

  const r = JSON.parse(produce.result) as AutoResult;
  const audio = getAsset(db, r.audioAssetId);
  const visual = getAsset(db, r.visualAssetId);
  const meta = getMetadata(db, project.id);
  const finalizeForThis =
    finalize && JSON.parse(finalize.payload).autoJobId === produce.id ? finalize : undefined;
  const pub = getPublication(db, project.id);
  const fin =
    finalizeForThis?.status === "succeeded" && finalizeForThis.result
      ? (JSON.parse(finalizeForThis.result) as { packageDir: string; video: string })
      : null;

  return (
    <section className="card full auto">
      <h2>Otomatik üretim</h2>
      <div className="two">
        <div>
          <h3>Önizleme (2 dk)</h3>
          <video controls preload="metadata" src={`/api/renders/${r.previewRenderId}/file`} />
          {r.notes.map((n, i) => (
            <p key={i} className="notice">
              {n}
            </p>
          ))}
        </div>
        <div>
          <h3>Kapak ve başlık</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb" src={`/api/assets/${r.thumbnailAssetId}/file`} alt="kapak" />
          <p>
            <strong>{meta?.yt_title}</strong>
          </p>
          <p className="muted">
            Ses: {audio?.original_name} ({formatClock(audio?.duration_sec ?? null)}) · Görüntü:{" "}
            {visual?.original_name}
          </p>
          <p className="muted">
            Başlık, açıklama ve kapağı aşağıdaki Gelişmiş › Yayın paketi bölümünden
            değiştirebilirsin.
          </p>
        </div>
      </div>

      <hr />
      {active(finalizeForThis) ? (
        <Progress job={finalizeForThis!} title="Tam render ve paket" />
      ) : fin ? (
        <div>
          <h3>Yükleme paketi hazır</h3>
          <p>
            Klasör: <code>{fin.packageDir}</code>
          </p>
          <p className="muted">
            İçinde video, <code>kapak.jpg</code> (+ deneme için <code>kapak-2.jpg</code>,{" "}
            <code>kapak-3.jpg</code>), <code>baslik-aciklama.txt</code> (yükleme kontrol listesi
            dahil), <code>lisanslar.txt</code> ve tanıtım için <code>short.mp4</code> +{" "}
            <code>short-baslik.txt</code> var.
          </p>
          <ol className="steps">
            <li>
              Videoyu izleyip kontrol et, uygunsa onayla. Durum:{" "}
              <strong>{STATUS_LABELS[project.status]}</strong>
              {project.status === "ready" && (
                <form action={setStatusAction} style={{ display: "inline-block", marginLeft: 8 }}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="to" value="approved" />
                  <button type="submit" style={{ marginTop: 0 }}>
                    Onayla
                  </button>
                </form>
              )}
            </li>
            <li>YouTube Studio&apos;ya videoyu ve kapağı yükle, metinleri dosyadan kopyala.</li>
            <li>
              Video bağlantısını buraya kaydet:
              {["approved", "uploaded", "scheduled", "published"].includes(project.status) ? (
                <RecordUploadForm
                  projectId={project.id}
                  video={pub?.youtube_video_id ?? undefined}
                  privacy={pub?.privacy}
                />
              ) : (
                <span className="muted"> (önce onayla)</span>
              )}
            </li>
          </ol>
        </div>
      ) : (
        <div>
          {finalizeForThis?.status === "failed" && (
            <p className="error">Tam render başarısız: {finalizeForThis.error_message}</p>
          )}
          <p>
            Önizleme hoşuna gittiyse tam süreli videoyu ({formatClock(project.duration_sec)}) ve
            yükleme paketini hazırla. Beğenmediysen baştan farklı bir varyasyon üret.
          </p>
          <div className="row-actions">
            <form action={autoFinalizeAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="autoJobId" value={produce.id} />
              <label htmlFor="dark">Ekran kararması (uyku için)</label>
              <select
                id="dark"
                name="darkAfterMin"
                defaultValue={
                  ["lofi", "piano_violin", "strings"].includes(project.category) ? "0" : "20"
                }
              >
                <option value="0">Kapalı (görüntü hep açık)</option>
                {[10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} dakika sonra kararsın
                  </option>
                ))}
              </select>
              <button type="submit">Beğendim: tam render + yükleme paketi</button>
            </form>
            <StartButton projectId={project.id} label="Baştan farklı üret" ghost />
          </div>
        </div>
      )}
    </section>
  );
}
