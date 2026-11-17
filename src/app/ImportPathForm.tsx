"use client";

import { useActionState } from "react";
import { type FormState, importAssetAction } from "./actions";

/** Buyuk dosyalar icin: bilgisayardaki dosya yolunu yazarak ekleme. */
export function ImportPathForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(importAssetAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="sourcePath">veya bilgisayardaki dosya yolu (büyük dosyalar için)</label>
      <input id="sourcePath" name="sourcePath" placeholder="D:\muzik\gece-yagmuru.wav" required />
      <label className="check">
        <input type="checkbox" name="asThumbnail" /> Kapak olarak ekle
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" className="ghost" disabled={pending}>
        {pending ? "Kopyalanıyor..." : "Yoldan ekle"}
      </button>
    </form>
  );
}
