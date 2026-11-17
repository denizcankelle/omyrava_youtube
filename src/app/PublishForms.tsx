"use client";

import { useActionState } from "react";
import { type PublishFormState, exportPackageAction, recordUploadAction } from "./actions";

export function ExportPackageForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(
    exportPackageAction,
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <button type="submit" disabled={pending}>
        {pending ? "Hazırlanıyor..." : "Yükleme paketini hazırla"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && (
        <p className="ok-text">
          <code>{state.ok}</code>
        </p>
      )}
    </form>
  );
}

export function RecordUploadForm({
  projectId,
  video,
  privacy,
}: {
  projectId: string;
  video?: string;
  privacy?: string;
}) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(
    recordUploadAction,
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="video">YouTube video bağlantısı veya kimliği</label>
      <input
        id="video"
        name="video"
        required
        defaultValue={video ?? ""}
        placeholder="https://youtu.be/xxxxxxxxxxx"
      />
      <div className="two">
        <div>
          <label htmlFor="privacy">Gizlilik</label>
          <select id="privacy" name="privacy" defaultValue={privacy ?? "private"}>
            <option value="private">Özel (private)</option>
            <option value="unlisted">Liste dışı (unlisted)</option>
            <option value="public">Herkese açık (public)</option>
          </select>
        </div>
        <div>
          <label htmlFor="scheduledAt">Planlanan yayın (isteğe bağlı)</label>
          <input id="scheduledAt" name="scheduledAt" type="datetime-local" />
        </div>
      </div>
      <label htmlFor="notes">Not</label>
      <input id="notes" name="notes" maxLength={500} />
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor..." : "YouTube'a yükledim"}
      </button>
    </form>
  );
}
