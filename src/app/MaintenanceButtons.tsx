"use client";

import { useActionState } from "react";
import { type PublishFormState, backupAction, cleanupAction } from "./actions";

export function MaintenanceButtons() {
  const [b, backup, pb] = useActionState<PublishFormState>(backupAction, {});
  const [c, clean, pc] = useActionState<PublishFormState>(cleanupAction, {});
  return (
    <div className="row-actions">
      <form action={backup}>
        <button type="submit" disabled={pb}>
          {pb ? "Yedekleniyor..." : "Şimdi yedekle"}
        </button>
        {b.ok && <p className="ok-text">{b.ok}</p>}
        {b.error && <p className="error">{b.error}</p>}
      </form>
      <form action={clean}>
        <button type="submit" className="ghost" disabled={pc}>
          {pc ? "Temizleniyor..." : "Eski ara dosyaları temizle"}
        </button>
        {c.ok && <p className="ok-text">{c.ok}</p>}
      </form>
    </div>
  );
}
