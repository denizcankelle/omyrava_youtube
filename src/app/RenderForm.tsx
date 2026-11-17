"use client";

import { useActionState, useState } from "react";
import { type FormState, enqueueRenderAction } from "./actions";

export interface Option {
  id: string;
  label: string;
  kind: string;
}

export function RenderForm({
  projectId,
  audios,
  visuals,
  durationLabel,
}: {
  projectId: string;
  audios: Option[];
  visuals: Option[];
  durationLabel: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(enqueueRenderAction, {});
  const [visualId, setVisualId] = useState(visuals[0]?.id ?? "");
  const visualKind = visuals.find((v) => v.id === visualId)?.kind;

  if (!audios.length || !visuals.length) {
    return (
      <p className="muted">
        Render için en az bir ses ve bir görsel/video döngü dosyası ekle (Varlıklar bölümü).
      </p>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="two">
        <div>
          <label htmlFor="audioAssetId">Ses</label>
          <select id="audioAssetId" name="audioAssetId" defaultValue={audios[0].id}>
            {audios.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="visualAssetId">Görüntü</label>
          <select
            id="visualAssetId"
            name="visualAssetId"
            value={visualId}
            onChange={(e) => setVisualId(e.target.value)}
          >
            {visuals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {visualKind === "video_loop" ? (
        <label className="check">
          <input type="checkbox" name="seamless" defaultChecked /> Döngüyü kusursuz yap (sonu başa 1
          sn çapraz geçiş)
        </label>
      ) : (
        <>
          <input type="hidden" name="seamless" value="false" />
          <label htmlFor="motion">Görsel hareketi</label>
          <select id="motion" name="motion" defaultValue="drift">
            <option value="drift">{"Çok yavaş kayma (60 sn'de bir tur)"}</option>
            <option value="none">Hareketsiz</option>
          </select>
        </>
      )}
      {state.error && <p className="error">{state.error}</p>}
      <div className="row-actions">
        <button type="submit" name="mode" value="preview" className="ghost" disabled={pending}>
          Önizleme (2 dk)
        </button>
        <button type="submit" name="mode" value="full" disabled={pending}>
          Tam render ({durationLabel})
        </button>
      </div>
    </form>
  );
}
