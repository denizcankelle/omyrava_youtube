import type { DB } from "@/lib/db";
import {
  ASSET_TYPE_LABELS,
  type Asset,
  formatBytes,
  formatClock,
  getLicense,
  listAssets,
} from "@/lib/assets";
import type { Analysis } from "@/lib/media";
import { assetJobAction, deleteAssetAction } from "./actions";
import { LicenseForm } from "./LicenseForm";

function AnalysisView({ asset }: { asset: Asset }) {
  if (!asset.analyzed_at)
    return <p className="muted">Analiz bekleniyor (worker çalışıyor olmalı)…</p>;
  if (!asset.analysis) return null;
  const a = JSON.parse(asset.analysis) as Analysis;
  return (
    <div>
      {a.kind === "audio" ? (
        <p className="stats">
          Süre {formatClock(a.durationSec)} · Seviye{" "}
          {a.loudness ? `${a.loudness.input_i.toFixed(1)} LUFS` : "-"} · Tepe{" "}
          {a.loudness ? `${a.loudness.input_tp.toFixed(1)} dBTP` : "-"} · Dalgalanma{" "}
          {a.loudness ? `${a.loudness.input_lra.toFixed(1)} LU` : "-"} · Sessizlik{" "}
          {a.silences.length} bölüm
        </p>
      ) : (
        <p className="stats">
          {a.width}×{a.height}
          {a.durationSec ? ` · ${formatClock(a.durationSec)}` : ""}
        </p>
      )}
      {a.warnings.length === 0 ? (
        <p className="ok-text">Kalite kontrolünde sorun bulunmadı.</p>
      ) : (
        <ul className="warn-list">
          {a.warnings.map((w, i) => (
            <li key={i} className={w.level}>
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Preview({ asset }: { asset: Asset }) {
  const src = `/api/assets/${asset.id}/file`;
  if (asset.type === "audio") return <audio controls preload="none" src={src} />;
  if (asset.type === "video_loop") return <video controls preload="metadata" src={src} />;
  if (asset.type === "image" || asset.type === "thumbnail")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={asset.original_name ?? ""} loading="lazy" />;
  return null;
}

export function AssetsSection({ db, projectId }: { db: DB; projectId: string }) {
  const assets = listAssets(db, projectId);
  const byId = new Map(assets.map((a) => [a.id, a]));

  return (
    <section className="card full">
      <h2>Üretilen dosyalar</h2>
      <p className="muted">
        Sistemin ürettiği tüm ses ve görüntü dosyaları. Her dosyanın SHA-256 özeti ve lisans kaydı
        otomatik tutulur.
      </p>

      {assets.length === 0 ? (
        <p className="empty">Henüz dosya yok.</p>
      ) : (
        assets.map((asset) => {
          const parent = asset.parent_asset_id ? byId.get(asset.parent_asset_id) : undefined;
          const license = getLicense(db, asset.parent_asset_id ?? asset.id);
          return (
            <div key={asset.id} className="asset">
              <div className="asset-head">
                <span className="badge">{ASSET_TYPE_LABELS[asset.type]}</span>
                <strong>{asset.original_name}</strong>
                <span className="muted">
                  {formatBytes(asset.size_bytes)}
                  {asset.duration_sec ? ` · ${formatClock(asset.duration_sec)}` : ""}
                </span>
                {license?.reviewed_at ? (
                  <span className="badge passed">Lisans onaylı</span>
                ) : (
                  <span className="badge failed">Lisans eksik</span>
                )}
              </div>
              {parent && (
                <p className="muted">Kaynak: {parent.original_name} (lisansı ondan alır)</p>
              )}
              <Preview asset={asset} />
              <AnalysisView asset={asset} />
              <div className="row-actions">
                <form action={assetJobAction}>
                  <input type="hidden" name="assetId" value={asset.id} />
                  <input type="hidden" name="jobType" value="asset_analyze" />
                  <button type="submit" className="ghost">
                    Yeniden analiz et
                  </button>
                </form>
                {asset.type === "audio" && !asset.parent_asset_id && (
                  <form action={assetJobAction}>
                    <input type="hidden" name="assetId" value={asset.id} />
                    <input type="hidden" name="jobType" value="audio_normalize" />
                    <button type="submit" className="ghost">
                      Normalize et (−18 LUFS + fade)
                    </button>
                  </form>
                )}
                <form action={deleteAssetAction}>
                  <input type="hidden" name="assetId" value={asset.id} />
                  <button type="submit" className="danger">
                    Sil
                  </button>
                </form>
              </div>
              {!asset.parent_asset_id && !license?.reviewed_at && (
                <details>
                  <summary>{license ? "Lisans bilgisini düzenle" : "Lisans bilgisi ekle"}</summary>
                  <LicenseForm assetId={asset.id} license={license} />
                </details>
              )}
              <p className="muted">
                <code>{asset.checksum?.slice(0, 16)}…</code>
              </p>
            </div>
          );
        })
      )}
    </section>
  );
}
