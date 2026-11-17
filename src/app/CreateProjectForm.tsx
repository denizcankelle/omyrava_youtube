"use client";

import { useActionState } from "react";
import { createProjectAction, type FormState } from "./actions";

const CATEGORIES: [string, string][] = [
  ["deep_sleep", "Deep Sleep (derin ambient)"],
  ["rain", "Rain (hafif yağmur + ambient)"],
  ["piano", "Piano (keçe piyano + yağmur)"],
  ["ocean", "Ocean (dalgalar + ambient)"],
  ["lofi", "Lo-fi (davulsuz, elektrikli piyano)"],
  ["meditation", "Meditation"],
  ["cosmic", "Cosmic"],
  ["piano_violin", "Piano & Violin (piyano + keman)"],
  ["nordic", "Nordic / Viking (İskandinav)"],
  ["strings", "Strings & Cello (yaylılar)"],
];

export function CreateProjectForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createProjectAction, {});
  return (
    <form action={action}>
      <label htmlFor="title">Başlık</label>
      <input
        id="title"
        name="title"
        required
        minLength={3}
        maxLength={100}
        placeholder="Deep Sleep - Gece Yağmuru"
      />
      <label htmlFor="category">Kategori</label>
      <select id="category" name="category" defaultValue="deep_sleep">
        {CATEGORIES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <label htmlFor="durationHours">Süre</label>
      <select id="durationHours" name="durationHours" defaultValue="8">
        {[1, 3, 8, 10].map((h) => (
          <option key={h} value={h}>
            {h} saat
          </option>
        ))}
      </select>
      <label htmlFor="resolution">Çözünürlük</label>
      <select id="resolution" name="resolution" defaultValue="4k">
        <option value="4k">4K (3840×2160)</option>
        <option value="1080p">1080p (daha küçük dosya)</option>
      </select>
      <label htmlFor="targetDate">Hedef tarih</label>
      <input id="targetDate" name="targetDate" type="date" />
      <label htmlFor="notes">Notlar</label>
      <textarea id="notes" name="notes" rows={3} maxLength={2000} />
      <label className="check">
        <input type="checkbox" name="autoStart" defaultChecked /> Oluşturunca her şeyi otomatik
        hazırla (ses, görüntü, 2 dk önizleme, kapak, başlık)
      </label>
      <label className="check">
        <input type="checkbox" name="useAi" defaultChecked /> Müzikte yapay zekâ kullan (Stable
        Audio 3 kuruluysa; değilse yerleşik besteci)
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor..." : "Proje oluştur"}
      </button>
    </form>
  );
}
