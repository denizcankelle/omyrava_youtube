/**
 * Yukleme oncesi kontrol listesi: paketteki her sartin yesil/kirmizi durumu.
 * Hepsi yesilse video YouTube'a hazirdir.
 */
import fs from "node:fs";
import path from "node:path";
import { getAsset } from "./assets";
import { comfortSummary } from "./comfort";
import type { DB } from "./db";
import type { AudioAnalysis } from "./media";
import { getProject } from "./projects";
import { resName } from "./render";
import { currentThumbnail, getMetadata, latestFullRender, metadataIssues } from "./publish";

export interface CheckItem {
  label: string;
  ok: boolean;
  /** Uyari: kirmizi degil ama dikkat (sari). */
  warn?: boolean;
  detail?: string;
}

export function uploadChecklist(db: DB, projectId: string, audioAssetId?: string): CheckItem[] {
  const project = getProject(db, projectId);
  if (!project) return [];
  const out: CheckItem[] = [];
  const render = latestFullRender(db, projectId);
  const videoOk = Boolean(render && fs.existsSync(render.output_path));
  out.push({
    label: "Tam video hazır ve kalite kontrolünden geçti",
    ok: videoOk && render!.qa_status === "passed",
    detail: render ? path.basename(render.output_path) : "tam render yok",
  });
  if (render) {
    const dur = render.duration_sec ?? 0;
    out.push({
      label: "Süre doğru",
      ok: Math.abs(dur - project.duration_sec) <= 2,
      detail: `${(dur / 3600).toFixed(2)} saat`,
    });
    const want = resName(project.resolution);
    out.push({
      label: `Çözünürlük ${want === "4k" ? "4K (3840×2160)" : want === "2k" ? "2K (2560×1440)" : "1080p"}`,
      ok: render.profile.endsWith(want),
    });
  }
  const meta = getMetadata(db, projectId);
  const issues = metadataIssues(db, projectId);
  const errors = issues.filter((i) => i.level === "error");
  out.push({
    label: "Başlık, açıklama ve etiketler YouTube kurallarına uygun",
    ok: errors.length === 0,
    warn: errors.length === 0 && issues.length > 0,
    detail: issues.map((i) => i.message).join("; ") || undefined,
  });
  if (meta) {
    const ai = Boolean(meta.ai_generated);
    out.push({
      label: ai ? "Yapay zekâ beyanı açıklamada var" : "Yapay zekâ kullanılmadı",
      ok: !ai || /AI tools|yapay zekâ/i.test(meta.description),
      detail: ai
        ? 'YouTube Studio\'da "Değiştirilmiş veya yapay içerik" sorusuna Evet de (gerçekçi sahne).'
        : undefined,
    });
    const chap = /(?:Tracklist|Parça listesi):\n([\s\S]*?)(?:\n\n|$)/.exec(meta.description);
    if (chap) {
      const lines = chap[1].split("\n").filter((l) => /^\d/.test(l));
      out.push({
        label: "Bölümler (chapters) geçerli",
        ok: lines.length >= 3 && /^0?0:00(:00)? /.test(lines[0]),
        detail: `${lines.length} parça`,
      });
    }
  }
  const audio = audioAssetId ? getAsset(db, audioAssetId) : undefined;
  if (audio?.analysis) {
    const a = JSON.parse(audio.analysis) as AudioAnalysis;
    const i = a.loudness?.input_i;
    const tp = a.loudness?.input_tp;
    out.push({
      label: "Ses seviyesi standartta (-18 LUFS, tepe ≤ -1 dBTP)",
      ok: i !== undefined && tp !== undefined && Math.abs(i + 18) <= 1.5 && tp <= -1,
      detail: i !== undefined ? `${i.toFixed(1)} LUFS, tepe ${tp?.toFixed(1)} dBTP` : undefined,
    });
    if (a.comfort)
      out.push({
        label: "Ses rahatlık testi (sert ve tiz bölge sınırın altında)",
        ok: a.comfort.ok,
        detail: comfortSummary(a.comfort),
      });
  }
  const thumb = currentThumbnail(db, projectId);
  const thumbOk = Boolean(thumb && fs.existsSync(thumb.file_path));
  out.push({
    label: "Kapak 1280×720 ve 2 MB altı",
    ok: thumbOk && (thumb!.size_bytes ?? 0) <= 2 * 1024 * 1024,
  });
  const dir = meta?.package_dir;
  const has = (f: string) => Boolean(dir && fs.existsSync(path.join(dir, f)));
  out.push({
    label: "Paket metinleri (baslik-aciklama.txt, lisanslar.txt)",
    ok: has("baslik-aciklama.txt") && has("lisanslar.txt"),
  });
  out.push({
    label: "Kapak testi için kapak-2.jpg ve kapak-3.jpg",
    ok: has("kapak-2.jpg") && has("kapak-3.jpg"),
    warn: !(has("kapak-2.jpg") && has("kapak-3.jpg")),
  });
  out.push({
    label: "Yazısız 2K kapak (kapak-yazisiz-2k.jpg, 2 MB altı)",
    ok:
      has("kapak-yazisiz-2k.jpg") &&
      fs.statSync(path.join(dir!, "kapak-yazisiz-2k.jpg")).size <= 2 * 1024 * 1024,
    warn: !has("kapak-yazisiz-2k.jpg"),
  });
  out.push({ label: "Shorts (short.mp4)", ok: has("short.mp4"), warn: !has("short.mp4") });
  out.push({
    label: "Çeviriler (ceviriler.txt)",
    ok: has("ceviriler.txt"),
    warn: !has("ceviriler.txt"),
  });
  return out;
}
