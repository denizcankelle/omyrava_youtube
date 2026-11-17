"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const ACCEPT = ".wav,.mp3,.flac,.m4a,.aac,.ogg,.opus,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mkv";

/** Dosyalari tek tek ham govde olarak yukler; ilerleme gosterir. */
export function AssetUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [asThumbnail, setAsThumbnail] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function uploadOne(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/assets`);
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      if (asThumbnail) xhr.setRequestHeader("x-asset-type", "thumbnail");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          setStatus(`${file.name}: %${Math.round((e.loaded / e.total) * 100)}`);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        try {
          reject(new Error((JSON.parse(xhr.responseText) as { error: string }).error));
        } catch {
          reject(new Error(`Yükleme başarısız (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Bağlantı hatası"));
      xhr.send(file);
    });
  }

  async function onUpload() {
    const files = Array.from(input.current?.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const errors: string[] = [];
    for (const f of files) {
      try {
        await uploadOne(f);
      } catch (err) {
        errors.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    setStatus(null);
    if (errors.length) setError(errors.join("\n"));
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div>
      <label htmlFor="files">Dosya yükle (ses, görsel, video döngü)</label>
      <input id="files" ref={input} type="file" multiple accept={ACCEPT} disabled={busy} />
      <label className="check">
        <input
          type="checkbox"
          checked={asThumbnail}
          onChange={(e) => setAsThumbnail(e.target.checked)}
        />
        Görselleri kapak olarak işaretle
      </label>
      <button type="button" onClick={onUpload} disabled={busy}>
        {busy ? "Yükleniyor..." : "Yükle"}
      </button>
      {status && <p className="muted">{status}</p>}
      {error && <pre className="error">{error}</pre>}
    </div>
  );
}
