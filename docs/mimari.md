# Mimari ve Kararlar

Kaynak: OMYRAVA Studio Proje Dokümanı v1.0. Aşağıdaki kararlar dokümandan farklılaşan noktalardır.

## Alınan kararlar (08.11.2026)

| Konu           | Doküman önerisi                 | Karar                                                            | Gerekçe                                      |
| -------------- | ------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| Dağıtım        | Docker Compose → bulut, hibrit  | Tamamen yerel, Windows bilgisayar                                | Kullanıcı tercihi; bulut yok                 |
| Yayın          | YouTube OAuth + API ile taslak  | Elle yükleme; sistem dosya + metin hazırlar                      | API yok; audit/kota sorunları ortadan kalkar |
| Kod barındırma | Repo / CI                       | Yerel klasör (`D:\iş\omyrava-studio`)                            | GitHub kullanılmıyor                         |
| Yapı           | pnpm monorepo, Next.js + NestJS | Tek Next.js uygulaması + ayrı worker süreci                      | Tek kişi, tek kanal; daha az bakım           |
| Veritabanı     | PostgreSQL + Prisma             | SQLite (Node yerleşik `node:sqlite`) + SQL migration             | Kurulum gerektirmez, tek dosya               |
| Kuyruk         | Redis + BullMQ                  | SQLite tablosu üzerinde kuyruk (retry, backoff, iptal, kurtarma) | Redis kurulumu gerekmez                      |
| Depolama       | S3 uyumlu                       | Yerel klasörler (`data/`, `output/`)                             | Yerel çalışma                                |
| Kimlik         | Oturum + OAuth, RBAC, MFA       | Panel yalnızca 127.0.0.1'e bağlanır, girişsiz                    | Tek kullanıcı, dışarıya kapalı               |

## Görev 002 kararları

- Müzik/görsel kaynağı henüz seçilmediği için varsayım: kullanıcı kendi dosyalarını yükler.
- Yükleme multipart değil ham gövde ile yapılır; dosya belleğe alınmadan diske akar (büyük WAV'lar için).
- Ses hedefi −18 LUFS / −2 dBTP (uyku içeriği için YouTube'un −14 LUFS'undan sakin). Kurallar `src/lib/media.ts` → `AUDIO_RULES`.
- Normalize çıktısı FLAC (kayıpsız); son AAC kodlaması render aşamasında bir kez yapılır.
- Türetilmiş varlıklar (normalize) ana varlığın lisansını devralır.

## Görev 003 kararları

- Video: H.264 1080p30, CRF 20, en fazla 8 Mbps, B-kare yok, 2 sn sabit GOP (döngü sınırında kopyalama güvenli).
- Ses: tam süre bir kez AAC 192 kbps; 5 sn fade-in / 10 sn fade-out.
- Görsel hareketi: 4K'da sinüs kayma (60 sn periyot) → 1080p; periyodik olduğu için döngü kusursuz.
- Aşamalar: video_loop → loop_qa → audio_loop → audio_full → mux → final_qa; `manifest.json` ile devam.
- Uzun çıktıda `+faststart` yok (10 saatlik dosyayı ikinci kez yazmamak için; YouTube gerektirmez).

## Görev 004 kararları

- Metaveri `project_metadata` tablosunda; şablonlar `src/lib/metadata.ts` (en/tr, 5 kategori).
- İddia filtresi: tedavi/şifa/garanti/mucize/frekans etkisi → hata; "treat" → uyarı.
- Kapak: FFmpeg drawtext; yazı tipi ve satırlar çalışma klasörüne kopyalanır (Windows yol kaçışı sorunu yok).
- Onay şartları: ses, onaylı lisanslar, QA'dan geçmiş tam render, hatasız metaveri, kapak.
- `uploaded` durumu ancak YouTube video kimliği kaydedilince; plan tarihi varsa `scheduled`, public ise `published`.

## Görev 005 kararları (müzik kaynağı)

- Öncelik: yerleşik FFmpeg sentezi (yapay zekâsız, lisans sorunsuz) + çok parçalı karışım.
- Sonraki adım: piyano/melodi için yerel yapay zekâ (Stable Audio 3 açık ağırlıklar; yıllık geliri 1 milyon doların altındaki işletmeler için ticari kullanım ücretsiz) — ekran kartı/VRAM bilgisi bekleniyor.
- Suno: yalnızca isteğe bağlı, elle; ücretli plan şart, resmî API yok.
- Sentez: `src/lib/synth.ts` (seed'li PRNG, aevalsrc/anoisesrc); `chorus` filtresi tıkırtı ürettiği için kullanılmıyor.
- Karışım: `acrossfade` zinciri (qsin), alt katman `-stream_loop` + `amix`, ardından iki geçişli loudnorm.
- node:sqlite satırları prototipsiz geldiği için `openDatabase` tüm satırları düz nesneye çevirir (Next.js istemci bileşenleri için).

## Görev 006 kararları (tam otomatik)

- Kullanıcı hiçbir dosya yüklemeyecek; yükleme arayüzü kaldırıldı (API ucu duruyor).
- Görsel üretimi `src/lib/visual.ts`: tohumlu gürültü eşikleme ile yıldız/yağmur/kar katmanları (gri),
  yumuşak gradyan arka plan, `alphamerge` + `overlay` ile birleştirme. (Doğrudan `blend` ile gri↔RGB
  karışımı FFmpeg'de yanlış renk veriyordu.) Kayan katmanların hızı döngü süresini tam böler.
- Otomatik akış `auto_produce` (ses varyasyonları → karışım → görüntü → 2 dk önizleme → metaveri → kapak)
  ve `auto_finalize` (tam render → paket). Alt adımlar aynı iş içinde çalışır; ilerleme `setProgressScope` ile eşlenir.
- İnsan onayı korunur: tam render ancak "Beğendim" ile, yayın onayı "Onayla" ile.
- Metaveride yapay zekâ kutusu varsayılan kapalı (her şey FFmpeg sentezi).

## Görev 007 kararları (besteci)

- Piyano/keman/İskandinav için yapay zekâ yerine algoritmik beste + SoundFont: GPU gerektirmez,
  lisans temiz (FluidR3_GM, MIT), tekrarlanabilir (seed).
- Sentez motoru `spessasynth_core` (Apache-2.0, saf JS); örnekler parça parça FFmpeg'e akıtılır (FLAC), bellek sabit.
- Yeni kategoriler: piano_violin, nordic, strings (005 migration, `-- @foreign_keys_off` ile tablo yeniden kurulumu).
- Yeni ses: rüzgâr; yeni görüntü: kuzey ışıkları.
- Aynı kanalda aynı nota üst üste gelirse önceki nota biraz önce kapatılır (test: `composer.test.ts`).

## Görev 008 kararları (yerel yapay zekâ)

- Model: Stable Audio 3 Medium (gerekirse small-music), kullanıcının RTX 5070 Ti'sinde. Kod `ai/stable-audio-3` (MIT, vendored), köprü `ai/omyrava_ai.py` (JSON satırları).
- Kurulum `AI-KUR.bat`: uv, Python 3.11, torch 2.7.1 cu128 (Blackwell), Windows flash-attn 2.7.4 cu128 tekerleği, HF_TOKEN (.env), test üretimi → `ai/ai-durum.json`, `ai/kurulum.log` (Claude VM'den okuyabilir).
- Model ağırlıkları `ai/hf-cache` (D: diski). Lisans: Stability AI Community License (< 1M $), Gemma şartları.
- Uzun parçalar: ≤360 sn bölümler, farklı istem/seed, 10 sn çapraz geçiş, -18 LUFS.
- Otomatik akış: yapay zekâ başarısızsa besteciye düşer; kullanıldıysa metaveride yapay zekâ beyanı açılır.

## Deep Sleep düzeltmesi (09.11.2026)

- Kullanıcı geri bildirimi: Deep Sleep "beyaz gürültü gibi". Ölçüm: karışımın enerjisi çoğunlukla 150 Hz altında
  (A1 drone'lar) → telefon/dizüstü hoparlörde yalnız kahverengi gürültü duyuluyordu.
- Çözüm: Deep Sleep artık besteci "deep_sleep" stili (sıcak pad, hafif koro, seyrek yumuşak piyano), gürültü katmanı yok.
  Drone kökü A2–E3'e çıkarıldı, harmonik eklendi.

## Durum makinesi

`draft → queued → generating → reviewing → rendering → ready → approved → uploaded → (scheduled) → published`

Yan durumlar: `qa_failed`, `failed`, `cancelled`. `approved` adımı dokümandaki "açık insan onayı"
gereksinimini karşılar: onaylanmamış proje `uploaded` olarak işaretlenemez.

## Render stratejisi (Görev 003 — uygulandı)

Uzun videolar kare kare encode edilmeyecek. Kısa, kusursuz döngü (30–60 sn) bir kez render edilir;
ardından FFmpeg `-stream_loop` + `-c copy` ile yeniden encode etmeden hedef süreye uzatılır ve ses
ayrı hazırlanıp birleştirilir. 10 saatlik video saatler yerine dakikalar içinde hazırlanır.

## Açık kalan kararlar

- Müzik kaynağı: kendi üretimin / ticari lisanslı kütüphane / AI sağlayıcı (lisans koşulları).
- Görsel kaynağı ve hareketli döngü üretim yöntemi.
- Hedef video sıklığı ve disk politikası (10 saatlik 1080p ≈ 10–20 GB).

## Görev 010 — 4K yapay zekâ görseli (13.11.2026)

- Kullanıcı yerleşik görselleri beğenmedi; 4K, yapay zekâ ile üretilmiş sahne istedi.
- `ai/omyrava_image.py`: FLUX.1-schnell (Apache-2.0). 16 GB VRAM için iki aşama: önce CLIP+T5
  istemleri kodlar ve bellekten atılır, sonra GGUF Q6_K dönüştürücü + VAE ile 1920×1088 üretim;
  Real-ESRGAN x2plus (spandrel, parçalı) ile 3840×2176 → ortadan 3840×2160. Ayrı ortam
  `ai/.venv-img` (müzik ortamını bozmamak için). Kurulum: `GORSEL-KUR.bat`, durum `ai/gorsel-durum.json`.
- `src/lib/scene.ts`: 10 sahne, kategori → sahne eşlemesi, istem bankası. Döngü: 60 sn, `perspective`
  ile alt piksel "nefes alan" %2,5 yakınlaşma + katmanlar (yağmur, kar, sis, yıldız/su pırıltısı).
  Tüm hareketler dönguyü tam böler; dokular 2×2 döşenip kesildiği için kenar dikişi yok.
- `ai_visual` işi; otomatik akış önce bunu dener, olmazsa `visual_generate`. Yapay zekâ görseli
  kullanılırsa metaveride yapay zekâ beyanı açılır.
- Render çözünürlüğe duyarlı (`dims`): profil `full_4k`/`preview_4k`; hedef çözünürlükteki
  yerleşik/AI döngüleri yeniden kodlanmadan kopyalanır. 4K x264: CRF 23, tavan 14 Mbps.
- Yeni projelerde varsayılan çözünürlük 4K.

## Görev 011 — büyüme araçları (16.11.2026)

- Karanlık ekran: `darkPlan` tam döngülerde kararma noktası seçer; `fade.mp4` (8 sn) ve `black.mp4`
  (60 sn) döngüyle aynı x264 ayarlarında kodlanır, concat demuxer + `-c copy` ile birleşir.
- Shorts (`src/lib/shorts.ts`): döngüden ortadan 9:16 kırpma, 30 sn, -14 LUFS; paket klasörüne.
- Kapak varyasyonları (`thumbnailArgs.variant` 0/1/2), sahne rotasyonu (`pickFreshScene`), başlık
  kalıbı rotasyonu (`suggestMetadata.variant`), 48 saat sık üretim uyarısı.
- Migration 007 `video_stats`; `src/lib/stats.ts` özet ve öneri; `/istatistik`.
- `src/lib/maintenance.ts`: `VACUUM INTO` yedek (14 adet), ara dosya temizliği; worker 6 saatte bir
  boşta çalıştırır; `/bakim`.

## Görev 012 — referanslara göre müzik (19.11.2026)

- Kullanıcı iki referans verdi: Nordic dark folk (sözsüz kadın vokali, tagelharpa, ritüel davul) ve
  dark blues (slide gitar, gece havası). Kanallar kopyalanmaz; yalnızca tür özellikleri alınır.
- Besteci: `nordic_ritual`, `dark_blues` stilleri; `bend` olayı (spessasynth `pitchWheel`) ile slide.
  Blues koruları süreyi doldurur, kalan süre i akorunda vamp ile kapanır (sessizlik yok).
- `src/lib/reverb.ts`: pembe gürültü + üstel sönüm IR, `afir` ile kuru/ıslak karışım; stil başına profil.
- Kategori `dark_blues` (migration 008), metaveri, yapay zekâ istemleri, mastering zinciri, 5 yeni sahne.

## Görev 013 — profesyonel üretim araçları (20.11.2026)

- Varyasyonlar: `auto_produce` payload `batch`/`variant`; sonuç `meta` taşır, `auto_finalize` seçilen
  varyasyonun metaverisini ve kapağını uygular. AutoSection en son partiyi kart olarak gösterir.
- `src/lib/tracklist.ts`: parça adı bankaları, başlangıç zamanları (çapraz geçiş düşülerek),
  YouTube bölüm koşulları; tarif `playlist: true`.
- Sahne katmanları `flicker` (geq ile düşük çözünürlükte, döngüye tam sığan 3 frekans) ve `smoke`
  (her yönde döşenen doku, yukarı kayar).
- GeneralUser GS 2.0.3 (lisans: "use without restriction for your own music creation, private or
  commercial"); `STYLE_BANK` ile stil başına seçim; KUR.bat indirir.
- `src/lib/plan.ts` + `/plan`; `src/lib/translations.ts` + `ceviriler.txt`.
