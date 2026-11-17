"use client";

import { useActionState, useState } from "react";
import { type PublishFormState, saveMetadataAction } from "./actions";

export function MetadataForm(props: {
  projectId: string;
  language: "en" | "tr";
  title: string;
  description: string;
  tags: string[];
  playlist: string;
  aiGenerated: boolean;
}) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(
    saveMetadataAction,
    {},
  );
  const [title, setTitle] = useState(props.title);
  const [description, setDescription] = useState(props.description);
  const [tags, setTags] = useState(props.tags.join(", "));
  const tagLen = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",").length;

  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={props.projectId} />
      <input type="hidden" name="language" value={props.language} />
      <label htmlFor="ytTitle">
        YouTube başlığı <span className="muted">({title.length}/100)</span>
      </label>
      <input
        id="ytTitle"
        name="ytTitle"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
      />
      <label htmlFor="description">
        Açıklama <span className="muted">({description.length}/5000)</span>
      </label>
      <textarea
        id="description"
        name="description"
        rows={12}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label htmlFor="tags">
        Etiketler, virgülle <span className="muted">(~{tagLen}/500)</span>
      </label>
      <textarea
        id="tags"
        name="tags"
        rows={2}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <label htmlFor="playlist">Oynatma listesi (isteğe bağlı)</label>
      <input id="playlist" name="playlist" defaultValue={props.playlist} />
      <label className="check">
        <input type="checkbox" name="aiGenerated" defaultChecked={props.aiGenerated} />
        Müzik veya görüntüde yapay zekâ kullanıldı
      </label>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor..." : "Metaveriyi kaydet"}
      </button>
    </form>
  );
}
