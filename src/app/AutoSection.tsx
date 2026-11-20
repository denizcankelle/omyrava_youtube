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
  meta?: { title: string };
}

/** En son "parti"nin hazirlik isleri (tek uretim ya da 3 varyasyon). */
function latestBatch(db: DB, projectId: string): Job[] {
  const jobs = db
    .prepare(
      "SELECT * FROM jobs WHERE project_id = ? AND type = 'auto_produce' ORDER BY created_at DESC LIMIT 12",
    )
    .all(projectId) as unknown as Job[];
  if (!jobs.length) return [];
  const batchOf = (j: Job) => (JSON.parse(j.payload) as { batch?: string }).batch ?? j.id;
  const b = batchOf(jobs[0]);
  return jobs.filter((j) => batchOf(j) === b).reverse();
}

function lastFinalize(db: DB, projectId: string): Job | undefined {
  return db
    .prepare(
      "SELECT * FROM jobs WHERE project_id = ? AND type = 'auto_finalize' ORDER BY created_at DESC LIMIT 1",
    )
    .get(projectId) as Job | undefined;
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

function StartButtons({ projectId, again }: { projectId: string; again?: boolean }) {
  return (
    <div className="row-actions">
      <form action={autoProduceAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="variants" value="3" />
        <button type="submit">
          {again ? "3 yeni varyasyon hazırla" : "3 varyasyon hazırla, ben seçeyim"}
        </button>
      </form>
      <form action={autoProduceAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <button type="submit" className="ghost">
          {again ? "Tek yeni varyasyon" : "Tek seferde hazırla"}
        </button>
      </form>
    </div>
  );
}

function FinalizeForm({ project, autoJobId }: { project: Project; autoJobId: string }) {
  const darkOff = ["lofi", "piano_violin", "strings", "dark_blues", "nordic"].includes(
    project.category,
  );
  return (
    <form action={autoFinalizeAction}>
      <input type="hidden" name="projectId" value={project.id} />
      <input type="hidden" name="autoJobId" value={autoJobId} />
      <label htmlFor={`dark-${autoJobId}`}>Ekran kararması (uyku için)</label>
      <select id={`dark-${autoJobId}`} name="darkAfterMin" defaultValue={darkOff ? "0" : "20"}>
        <option value="0">Kapalı (görüntü hep açık)</option>
        {[10, 15, 20, 30, 45, 60].map((m) => (
          <option key={m} value={m}>
            {m} dakika sonra kararsın
          </option>
        ))}
      </select>
      <button type="submit">Bunu seç: tam render + yükleme paketi</button>
    </form>
  );
}

function VariantCard({
  db,
  project,
  job,
  index,
  total,
  canFinalize,
}: {
  db: DB;
  project: Project;
  job: Job;
  index: number;
  total: number;
  canFinalize: boolean;
}) {
  const title = total > 1 ? `Varyasyon ${index + 1}` : "Önizleme (2 dk)";
  if (job.status === "queued" || job.status === "running")
    return (
      <div className="variant">
        <Progress job={job} title={`${title}: hazırlanıyor`} />
      </div>
    );
  if (job.status !== "succeeded" || !job.result)
    return (
      <div className="variant">
        <h3>{title}</h3>
        <p className="error">Hazırlanamadı{job.error_message ? `: ${job.error_message}` : ""}.</p>
      </div>
    );
  const r = JSON.parse(job.result) as AutoResult;
  const audio = getAsset(db, r.audioAssetId);
  const visual = getAsset(db, r.visualAssetId);
  return (
    <div className="variant">
      <h3>{title}</h3>
      <video controls preload="metadata" src={`/api/renders/${r.previewRenderId}/file`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="thumb" src={`/api/assets/${r.thumbnailAssetId}/file`} alt="kapak" />
      <p>
        <strong>{r.meta?.title ?? getMetadata(db, project.id)?.yt_title}</strong>
      </p>
      <p className="muted">
        Ses: {audio?.original_name} ({formatClock(audio?.duration_sec ?? null)}) · Görüntü:{" "}
        {visual?.original_name}
      </p>
      {r.notes.map((n, i) => (
        <p key={i} className="notice">
          {n}
        </p>
      ))}
      {canFinalize && <FinalizeForm project={project} autoJobId={job.id} />}
    </div>
  );
}

export function AutoSection({ db, project }: { db: DB; project: Project }) {
  const batch = latestBatch(db, project.id);
  const finalize = lastFinalize(db, project.id);
  const active = (j?: Job) => j && (j.status === "queued" || j.status === "running");

  if (!batch.length) {
    return (
      <section className="card full auto">
        <h2>Otomatik üretim</h2>
        <p>
          Kategoriye uygun müzik, 4K hareketli sahne, 2 dakikalık önizleme, 3 kapak ve YouTube
          başlığı/açıklaması hazırlanır. Önerilen yol: <strong>3 varyasyon</strong> üret, dinleyip
          en iyisini seç. İnsan seçimi hem kaliteyi artırır hem YouTube&apos;un seri üretim kuralına
          karşı en iyi korumadır.
        </p>
        <StartButtons projectId={project.id} />
      </section>
    );
  }

  const batchIds = new Set(batch.map((j) => j.id));
  const finForBatch =
    finalize && batchIds.has(JSON.parse(finalize.payload).autoJobId) ? finalize : undefined;
  const chosenId = finForBatch ? (JSON.parse(finForBatch.payload).autoJobId as string) : null;
  const fin =
    finForBatch?.status === "succeeded" && finForBatch.result
      ? (JSON.parse(finForBatch.result) as { packageDir: string; video: string })
      : null;
  const pub = getPublication(db, project.id);
  const busy = batch.some((j) => active(j)) || active(finForBatch);
  const visible =
    chosenId && finForBatch?.status !== "failed" ? batch.filter((j) => j.id === chosenId) : batch;

  return (
    <section className="card full auto">
      <h2>Otomatik üretim</h2>
      {batch.length > 1 && !chosenId && (
        <p className="muted">
          Varyasyonları dinle; beğendiğinin altındaki düğmeyle tam videoyu hazırla. Seçtiğin
          varyasyonun başlığı, açıklaması ve kapağı kullanılır.
        </p>
      )}
      <div className={visible.length > 1 ? "variants" : undefined}>
        {visible.map((j) => (
          <VariantCard
            key={j.id}
            db={db}
            project={project}
            job={j}
            index={batch.indexOf(j)}
            total={batch.length}
            canFinalize={!busy && !fin}
          />
        ))}
      </div>

      <hr />
      {active(finForBatch) ? (
        <Progress job={finForBatch!} title="Tam render ve paket" />
      ) : fin ? (
        <div>
          <h3>Yükleme paketi hazır</h3>
          <p>
            Klasör: <code>{fin.packageDir}</code>
          </p>
          <p className="muted">
            İçinde video, <code>kapak.jpg</code> (+ deneme için <code>kapak-2.jpg</code>,{" "}
            <code>kapak-3.jpg</code>), <code>baslik-aciklama.txt</code> (yükleme kontrol listesi
            dahil), <code>ceviriler.txt</code> (başka dillerde başlık/açıklama),{" "}
            <code>lisanslar.txt</code> ve tanıtım için <code>short.mp4</code> +{" "}
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
            <li>
              YouTube Studio&apos;ya videoyu ve kapağı yükle, metinleri dosyadan kopyala. Çevirileri
              Studio › Altyazılar › Dil ekle bölümünden gir.
            </li>
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
          {finForBatch?.status === "failed" && (
            <p className="error">Tam render başarısız: {finForBatch.error_message}</p>
          )}
          {!busy && (
            <>
              <p className="muted">Hiçbiri olmadıysa baştan farklı varyasyonlar üret.</p>
              <StartButtons projectId={project.id} again />
            </>
          )}
        </div>
      )}
    </section>
  );
}
