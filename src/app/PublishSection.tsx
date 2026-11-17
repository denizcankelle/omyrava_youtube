import type { DB } from "@/lib/db";
import { formatBytes, formatClock, listAssets } from "@/lib/assets";
import type { Project } from "@/lib/projects";
import {
  currentThumbnail,
  ensureMetadata,
  getPublication,
  latestFullRender,
  metadataIssues,
} from "@/lib/publish";
import { generateThumbnailAction, selectThumbnailAction, suggestMetadataAction } from "./actions";
import { MetadataForm } from "./MetadataForm";
import { ExportPackageForm, RecordUploadForm } from "./PublishForms";

export function PublishSection({ db, project }: { db: DB; project: Project }) {
  const meta = ensureMetadata(db, project);
  const issues = metadataIssues(db, project.id);
  const assets = listAssets(db, project.id);
  const sources = assets.filter((a) => a.type === "image" || a.type === "video_loop");
  const thumbs = assets.filter((a) => a.type === "thumbnail");
  const selected = currentThumbnail(db, project.id);
  const render = latestFullRender(db, project.id);
  const pub = getPublication(db, project.id);
  const canRecord = ["approved", "uploaded", "scheduled", "published"].includes(project.status);

  return (
    <section className="card full">
      <h2>Yayın paketi</h2>

      <div className="two">
        <div>
          <h3>1. Başlık, açıklama, etiketler</h3>
          <form
            action={suggestMetadataAction}
            className="row-actions"
            style={{ alignItems: "end" }}
          >
            <input type="hidden" name="projectId" value={project.id} />
            <div style={{ flex: "1 1 160px" }}>
              <label htmlFor="scene">Sahne (başlığa eklenir)</label>
              <input id="scene" name="scene" placeholder="Rainy Night Window" />
            </div>
            <div>
              <label htmlFor="language">Dil</label>
              <select id="language" name="language" defaultValue={meta.language}>
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
            <input type="hidden" name="aiGenerated" value={meta.ai_generated ? "on" : ""} />
            <button type="submit" className="ghost">
              Şablondan doldur
            </button>
          </form>
          <p className="muted">Şablondan doldurmak mevcut metnin üzerine yazar.</p>
          <MetadataForm
            key={meta.updated_at}
            projectId={project.id}
            language={meta.language}
            title={meta.yt_title}
            description={meta.description}
            tags={JSON.parse(meta.tags) as string[]}
            playlist={meta.playlist ?? ""}
            aiGenerated={Boolean(meta.ai_generated)}
          />
          {issues.length === 0 ? (
            <p className="ok-text">Metaveri kontrolünde sorun yok.</p>
          ) : (
            <ul className="warn-list">
              {issues.map((i, k) => (
                <li key={k} className={i.level}>
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>2. Kapak</h3>
          {sources.length === 0 ? (
            <p className="muted">Kapak üretmek için önce bir görsel veya video döngü ekle.</p>
          ) : (
            <form action={generateThumbnailAction}>
              <label htmlFor="thumbSource">Kaynak</label>
              <select id="thumbSource" name="assetId">
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.original_name}
                  </option>
                ))}
              </select>
              <label htmlFor="thumbText">Kapak yazısı (en fazla 2 satır, isteğe bağlı)</label>
              <textarea id="thumbText" name="text" rows={2} placeholder={"8 HOURS\nRAIN SOUNDS"} />
              <button type="submit" className="ghost">
                Kapak üret (1280×720)
              </button>
            </form>
          )}
          <p className="muted">
            Hazır bir kapağın varsa Varlıklar bölümünden “kapak olarak” yükle.
          </p>
          {thumbs.map((t) => (
            <div key={t.id} className="asset">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${t.id}/file`} alt={t.original_name ?? "kapak"} />
              <div className="asset-head">
                <span className="muted">
                  {t.original_name} · {formatBytes(t.size_bytes)}
                </span>
                {selected?.id === t.id ? (
                  <span className="badge passed">Seçili</span>
                ) : (
                  <form action={selectThumbnailAction}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="assetId" value={t.id} />
                    <button type="submit" className="ghost" style={{ marginTop: 0 }}>
                      Bunu kullan
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}

          <h3 style={{ marginTop: 24 }}>3. Paket</h3>
          {render ? (
            <p className="muted">
              Video: <code>{render.output_path}</code> ({formatClock(render.duration_sec)},{" "}
              {formatBytes(render.size_bytes)})
            </p>
          ) : (
            <p className="muted">Önce kalite kontrolünden geçen bir tam render al.</p>
          )}
          <p className="muted">
            Video klasörüne <code>baslik-aciklama.txt</code>, <code>lisanslar.txt</code> ve kapak
            yazılır.
            {meta.package_dir && (
              <>
                {" "}
                Son paket: <code>{meta.package_dir}</code>
              </>
            )}
          </p>
          <ExportPackageForm projectId={project.id} />

          <h3 style={{ marginTop: 24 }}>4. YouTube kaydı</h3>
          {pub?.youtube_video_id && (
            <p>
              <a href={pub.url ?? "#"} target="_blank" rel="noreferrer">
                {pub.url}
              </a>{" "}
              <span className="badge">{pub.status}</span>
              {pub.scheduled_at && (
                <span className="muted">
                  {" "}
                  · plan: {new Date(pub.scheduled_at).toLocaleString("tr-TR")}
                </span>
              )}
            </p>
          )}
          {canRecord ? (
            <RecordUploadForm
              projectId={project.id}
              video={pub?.youtube_video_id ?? undefined}
              privacy={pub?.privacy}
            />
          ) : (
            <p className="muted">
              Videoyu yükledikten sonra kaydetmek için proje önce “Onaylandı” durumunda olmalı.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
