# Ses kuralları (27.11.2026)

Amaç: hiçbir ses kulağı ve bünyeyi yormasın. Araştırma özeti ve kaynaklar proje dokümanında
(`ses-tasarim-raporu.md`). Uygulama:

| Kural | Nerede |
|---|---|
| Sertlik (2–5 kHz) ve tizlik (6 kHz üstü) ölçümü, sınır aşılırsa otomatik yumuşatma (en çok 3 tur) | `src/lib/comfort.ts`, `solveComfort` (`src/worker/handlers.ts`); karışım, besteci ve yapay zekâ müziğinde |
| Sınırlar: uyku −18 / −30 dB, doğa sesli −13 / −21 dB, dinleme −15 / −24 dB (toplam seviyeye göre) | `COMFORT_LIMITS` |
| Yükleme kontrol listesinde "Ses rahatlık testi" | `src/lib/checklist.ts` |
| Yağmur daha boğuk (üst sınır 4,5–5,5 kHz; cam yağmuru 3,4–4,2 kHz), alt gövde belirgin | `src/lib/synth.ts` |
| Tür bazlı ton: 3 kHz çevresi geniş bant kesim, tiz raf | `src/lib/mastering.ts` |
| Uyku stillerinde melodi tavanı E5, akorlar orta perdede, majör ağırlık | `src/lib/composer.ts` |
| Nordic: vokal A3–C5, flüt ve keman cevabı alçak ve geri planda | `src/lib/composer.ts` |
| Dark Blues: slide gitar A3–D5, vibrato az, davul ve ziller kısık | `src/lib/composer.ts` |
| Yayın planı sırası: yağmur, piyano, derin uyku önce | `src/lib/plan.ts` |
