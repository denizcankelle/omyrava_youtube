"use client";

import { useActionState, useState } from "react";
import {
  type PublishFormState,
  generateAudioAction,
  aiMusicAction,
  aiVisualAction,
  generateVisualAction,
  mixAudioAction,
} from "./actions";

export interface Track {
  id: string;
  name: string;
  durationSec: number | null;
  licensed: boolean;
}

const PRESETS: [string, string][] = [
  ["waves", "Okyanus dalgaları"],
  ["brown_noise", "Kahverengi gürültü"],
  ["pink_noise", "Pembe gürültü"],
  ["drone", "Yumuşak drone (Cosmic)"],
  ["pad", "Yumuşak pad akorları (Meditation)"],
  ["wind", "Rüzgâr (kuzey)"],
  ["waves_soft", "Uzak, küçük dalgalar"],
  ["ambient_warm", "Kadife sıcak ambient"],
  ["deep_ambient", "Derin ambient (karışan 3 ses)"],
  ["vinyl_hiss", "Plak dokusu (çok hafif)"],
];

const MUSIC: [string, string][] = [
  ["nordic", "İskandinav / Viking ambient"],
  ["piano", "Solo piyano"],
  ["piano_violin", "Romantik piyano (melodili)"],
  ["deep_sleep", "Derin uyku ambiyansı (pad + piyano)"],
  ["felt_piano", "Keçe piyano (seyrek, melodisiz)"],
  ["lofi", "Davulsuz lo-fi"],
  ["nordic_ritual", "İskandinav ritüel (dark folk)"],
  ["dark_blues", "Dark blues"],
];

const clock = (s: number | null) =>
  s === null ? "?" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function GenerateForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(
    generateAudioAction,
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="preset">Ses türü</label>
      <select id="preset" name="preset" defaultValue="music:nordic">
        <optgroup label="Müzik (besteci)">
          {MUSIC.map(([v, l]) => (
            <option key={v} value={`music:${v}`}>
              {l}
            </option>
          ))}
        </optgroup>
        <optgroup label="Doğa ve ambiyans sesleri">
          {PRESETS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </optgroup>
      </select>
      <div className="two">
        <div>
          <label htmlFor="minutes">Uzunluk</label>
          <select id="minutes" name="minutes" defaultValue="15">
            {[5, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} dakika
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="count">Kaç farklı varyasyon</label>
          <select id="count" name="count" defaultValue="1">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kuyruğa alınıyor..." : "Ses üret"}
      </button>
    </form>
  );
}

export function MixBuilder({ projectId, tracks }: { projectId: string; tracks: Track[] }) {
  const [order, setOrder] = useState<string[]>([]);
  const [crossfade, setCrossfade] = useState(20);
  const [bedId, setBedId] = useState("");
  const [bedDb, setBedDb] = useState(-14);
  const [normalize, setNormalize] = useState(true);
  // React gonderimden sonra form alanlarini sifirlar; secim durumunu da sifirla.
  const [state, action, pending] = useActionState<PublishFormState, FormData>(async (prev, fd) => {
    const r = await mixAudioAction(prev, fd);
    if (r.ok) {
      setOrder([]);
      setBedId("");
    }
    return r;
  }, {});
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const selected = order.filter((id) => byId.has(id));
  const total =
    selected.reduce((s, id) => s + (byId.get(id)?.durationSec ?? 0), 0) -
    Math.max(0, selected.length - 1) * crossfade;

  const toggle = (id: string) =>
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const move = (id: string, dir: -1 | 1) =>
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  if (tracks.length === 0) return <p className="muted">Karışım için önce ses üret veya yükle.</p>;

  return (
    <form action={action}>
      <input
        type="hidden"
        name="payload"
        value={JSON.stringify({
          projectId,
          trackIds: selected,
          crossfadeSec: crossfade,
          bedId: bedId || null,
          bedDb,
          normalize,
        })}
      />
      <label>Parçalar (sırayla seç; sırayı oklarla değiştir)</label>
      <ul className="track-list">
        {tracks.map((t) => {
          const pos = selected.indexOf(t.id);
          return (
            <li key={t.id}>
              <label className="check">
                <input type="checkbox" checked={pos >= 0} onChange={() => toggle(t.id)} />
                {pos >= 0 && <span className="badge">{pos + 1}</span>}
                <span>
                  {t.name} <span className="muted">({clock(t.durationSec)})</span>
                  {!t.licensed && <span className="error"> lisans onaysız</span>}
                </span>
              </label>
              {pos >= 0 && (
                <span className="row-actions">
                  <button type="button" className="ghost mini" onClick={() => move(t.id, -1)}>
                    ↑
                  </button>
                  <button type="button" className="ghost mini" onClick={() => move(t.id, 1)}>
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="two">
        <div>
          <label htmlFor="xf">Geçiş süresi: {crossfade} sn</label>
          <input
            id="xf"
            type="range"
            min={0}
            max={30}
            value={crossfade}
            onChange={(e) => setCrossfade(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="bed">Alt katman (tüm süre boyunca, örn. yağmur)</label>
          <select id="bed" value={bedId} onChange={(e) => setBedId(e.target.value)}>
            <option value="">Yok</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {bedId && (
            <>
              <label htmlFor="bedDb">Alt katman seviyesi: {bedDb} dB</label>
              <input
                id="bedDb"
                type="range"
                min={-30}
                max={-3}
                value={bedDb}
                onChange={(e) => setBedDb(Number(e.target.value))}
              />
            </>
          )}
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={normalize}
          onChange={(e) => setNormalize(e.target.checked)}
        />
        Sonucu −18 LUFS&apos;a normalize et
      </label>
      <p className="muted">
        Seçili: {selected.length} parça · yaklaşık {Math.max(0, Math.round(total / 60))} dakika
      </p>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending || selected.length === 0}>
        {pending ? "Kuyruğa alınıyor..." : "Karışımı oluştur"}
      </button>
    </form>
  );
}

const VISUALS: [string, string][] = [
  ["starry_sky", "Yıldızlı gökyüzü"],
  ["night_sky", "Sakin gece gökyüzü"],
  ["rain_window", "Yağmurlu gece"],
  ["snow", "Yağan kar"],
  ["mist", "Yumuşak sis ve ışık"],
  ["aurora", "Kuzey ışıkları"],
];

export function GenerateVisualForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(
    generateVisualAction,
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="vpreset">Görüntü türü</label>
      <select id="vpreset" name="preset" defaultValue="starry_sky">
        {VISUALS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kuyruğa alınıyor..." : "Görüntü üret"}
      </button>
    </form>
  );
}

const AI: [string, string][] = [
  ["nordic", "İskandinav / Viking"],
  ["piano", "Solo piyano"],
  ["piano_violin", "Romantik piyano (melodili)"],
  ["meditation", "Meditasyon ambiyansı"],
  ["deep_sleep", "Derin uyku ambiyansı"],
  ["cosmic", "Kozmik ambiyans"],
  ["lofi", "Davulsuz lo-fi"],
  ["dark_blues", "Dark blues"],
];

export function AiMusicForm({
  projectId,
  ready,
  model,
  error,
}: {
  projectId: string;
  ready: boolean;
  model?: string;
  error?: string;
}) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(aiMusicAction, {});
  if (!ready) {
    return (
      <div className="notice">
        Yapay zekâ henüz kurulu değil{error ? `: ${error}` : "."} Kurulum için proje klasöründeki
        <code> ai\YAPAY-ZEKA-KURULUM.txt</code> adımlarını izle ve <code>AI-KUR.bat</code>&apos;ı
        çalıştır.
      </div>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <p className="ok-text">Hazır: Stable Audio 3 {model}</p>
      <div className="two">
        <div>
          <label htmlFor="aistyle">Stil</label>
          <select id="aistyle" name="style" defaultValue="nordic">
            {AI.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="aimin">Toplam süre</label>
          <select id="aimin" name="minutes" defaultValue="10">
            {[2, 5, 10, 20, 30].map((m) => (
              <option key={m} value={m}>
                {m} dakika
              </option>
            ))}
          </select>
        </div>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kuyruğa alınıyor..." : "Yapay zekâ ile müzik üret"}
      </button>
    </form>
  );
}

const AI_SCENES: [string, string][] = [
  ["", "Kategoriye göre otomatik"],
  ["rain_room", "Yağmurlu pencere, sıcak oda"],
  ["rain_cabin", "Yağmurda orman kulübesi"],
  ["lofi_desk", "Gece masası, yağmurlu cam"],
  ["fjord_aurora", "Fiyort ve kuzey ışıkları"],
  ["snow_forest", "Karlı çam ormanı"],
  ["misty_lake", "Sisli dağ gölü"],
  ["ocean_moon", "Ay ışığında sakin okyanus"],
  ["ocean_dusk", "Gün batımında kıyı"],
  ["milky_way", "Samanyolu ve yıldızlı gece"],
  ["cosmic", "Kozmik bulutsu"],
  ["viking_fire", "Fiyort kıyısında Viking ateşi"],
  ["rune_forest", "Sisli ormanda rün taşları"],
  ["blues_bar", "Loş blues barı"],
  ["desert_road", "Gece çöl yolu"],
  ["rain_city_night", "Yağmurlu gece sokağı"],
];

export function AiVisualForm({
  projectId,
  ready,
  error,
}: {
  projectId: string;
  ready: boolean;
  error?: string;
}) {
  const [state, action, pending] = useActionState<PublishFormState, FormData>(aiVisualAction, {});
  if (!ready) {
    return (
      <div className="notice">
        Görsel yapay zekâsı henüz kurulu değil{error ? `: ${error}` : "."} Proje klasöründeki
        <code> ai\GORSEL-KURULUM.txt</code> adımlarını izle ve <code>GORSEL-KUR.bat</code>&apos;ı
        çalıştır. Kurulana kadar yerleşik görseller kullanılır.
      </div>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <p className="ok-text">Hazır: FLUX.1-schnell + 4K büyütme</p>
      <label htmlFor="aiscene">Sahne</label>
      <select id="aiscene" name="scene" defaultValue="">
        {AI_SCENES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="ok-text">{state.ok}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Kuyruğa alınıyor..." : "Yapay zekâ ile sahne üret"}
      </button>
    </form>
  );
}
