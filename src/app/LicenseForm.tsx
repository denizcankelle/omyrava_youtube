"use client";

import { useActionState } from "react";
import { type FormState, saveLicenseAction } from "./actions";

export interface LicenseValues {
  provider: string;
  license_type: string | null;
  terms_version: string | null;
  evidence_path: string | null;
  notes: string | null;
  reviewed_at: string | null;
}

export function LicenseForm({ assetId, license }: { assetId: string; license?: LicenseValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveLicenseAction, {});
  return (
    <form action={action} className="license-form">
      <input type="hidden" name="assetId" value={assetId} />
      <label>Kaynak / sağlayıcı</label>
      <input
        name="provider"
        required
        defaultValue={license?.provider ?? ""}
        placeholder="Kendi üretimim, Epidemic Sound, ..."
      />
      <label>Lisans türü</label>
      <input
        name="licenseType"
        defaultValue={license?.license_type ?? ""}
        placeholder="Ticari kullanım, YouTube para kazanma dahil"
      />
      <label>Şart sürümü / tarih</label>
      <input
        name="termsVersion"
        defaultValue={license?.terms_version ?? ""}
        placeholder="2026-11"
      />
      <label>Kanıt (dosya yolu veya bağlantı)</label>
      <input
        name="evidencePath"
        defaultValue={license?.evidence_path ?? ""}
        placeholder="D:\lisanslar\fatura.pdf"
      />
      <label>Notlar</label>
      <textarea name="notes" rows={2} defaultValue={license?.notes ?? ""} />
      <label className="check">
        <input type="checkbox" name="reviewed" defaultChecked={Boolean(license?.reviewed_at)} />
        Lisansı kontrol ettim, ticari kullanım uygun
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" className="ghost" disabled={pending}>
        {pending ? "Kaydediliyor..." : "Lisansı kaydet"}
      </button>
    </form>
  );
}
