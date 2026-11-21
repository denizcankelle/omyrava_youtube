"use client";

import { useActionState } from "react";
import { type PublishFormState, backupAction, cleanupAction, purgeUploadedAction } from "./actions";

export function PurgeButton({ disabled }: { disabled: boolean }) {
  const [p, purge, pp] = useActionState<PublishFormState>(purgeUploadedAction, {});
  return (
    <form action={purge}>
      <button type="submit" className="ghost" disabled={pp || disabled}>
        {pp ? "Siliniyor..." : "Yüklenmiş videoların büyük dosyalarını sil"}
      </button>
      {p.ok && <p className="ok-text">{p.ok}</p>}
    </form>
  );
}

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
