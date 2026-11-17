import type { DB } from "@/lib/db";
import { getLicense, listAssets } from "@/lib/assets";
import {
  AiMusicForm,
  AiVisualForm,
  GenerateForm,
  GenerateVisualForm,
  MixBuilder,
} from "./SoundStudio";
import { isImageAiReady, readImageStatus } from "@/lib/aiimage";
import { getConfig } from "@/lib/config";
import { isAiReady, readAiStatus } from "@/lib/ai";

export function SoundStudioSection({ db, projectId }: { db: DB; projectId: string }) {
  const tracks = listAssets(db, projectId)
    .filter((a) => a.type === "audio")
    .map((a) => ({
      id: a.id,
      name: a.original_name ?? a.id,
      durationSec: a.duration_sec,
      licensed: Boolean(getLicense(db, a.parent_asset_id ?? a.id)?.reviewed_at),
    }));
  const cfg = getConfig();
  const aiStatus = readAiStatus(cfg.aiDir);
  const aiReady = isAiReady(cfg.aiDir, cfg.aiPython);
  const imgStatus = readImageStatus(cfg.aiDir);
  const imgReady = isImageAiReady(cfg.aiDir, cfg.imagePython);
  return (
    <section className="card full">
      <h2>Stüdyo: ses ve görüntü</h2>
      <p className="muted">
        Yapay zekâ kullanmadan, FFmpeg ile sıfırdan ses ve görüntü üretir. Her varyasyon farklı bir
        rastgele tohumla (seed) üretilir; sonuç tamamen sana aittir ve lisans kaydı otomatik
        eklenir. Uzun videolarda tekrarı azaltmak için birkaç varyasyon üretip aşağıda karışım yap.
      </p>
      <div className="two">
        <div>
          <h3>Yapay zekâ ile müzik (Stable Audio 3)</h3>
          <AiMusicForm
            projectId={projectId}
            ready={aiReady}
            model={aiStatus?.model}
            error={aiStatus?.error}
          />
          <h3 style={{ marginTop: 24 }}>Ses üret (besteci ve doğa sesleri)</h3>
          <GenerateForm projectId={projectId} />
          <h3 style={{ marginTop: 24 }}>Yapay zekâ ile 4K sahne (FLUX)</h3>
          <AiVisualForm projectId={projectId} ready={imgReady} error={imgStatus?.error} />
          <h3 style={{ marginTop: 24 }}>Yerleşik görüntü (yapay zekâsız)</h3>
          <GenerateVisualForm projectId={projectId} />
        </div>
        <div>
          <h3>Uzun karışım</h3>
          <MixBuilder key={tracks.map((t) => t.id).join()} projectId={projectId} tracks={tracks} />
        </div>
      </div>
    </section>
  );
}
