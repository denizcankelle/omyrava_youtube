"use client";

import { useActionState } from "react";
import { type PublishFormState, addStatAction } from "./actions";

export function StatsForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(addStatAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="two">
        <div>
          <label htmlFor="views">Görüntülenme</label>
          <input id="views" name="views" inputMode="numeric" required placeholder="1250" />
        </div>
        <div>
          <label htmlFor="watchHours">İzlenme süresi (saat)</label>
          <input id="watchHours" name="watchHours" inputMode="decimal" placeholder="310" />
        </div>
        <div>
          <label htmlFor="avgViewMin">Ortalama izleme (dakika)</label>
          <input id="avgViewMin" name="avgViewMin" inputMode="decimal" placeholder="14.5" />
        </div>
        <div>
          <label htmlFor="ctr">Tıklama oranı (%)</label>
          <input id="ctr" name="ctr" inputMode="decimal" placeholder="4.2" />
        </div>
        <div>
          <label htmlFor="subscribers">Kazanılan abone</label>
          <input id="subscribers" name="subscribers" inputMode="numeric" placeholder="12" />
        </div>
        <div>
          <label htmlFor="recordedAt">Tarih</label>
          <input id="recordedAt" name="recordedAt" type="date" />
        </div>
      </div>
      <label htmlFor="snotes">Not</label>
      <input id="snotes" name="notes" maxLength={500} placeholder="ör. 7. gün" />
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor..." : "İstatistiği kaydet"}
      </button>
    </form>
  );
}
