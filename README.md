# Omyrava Studio

Uyku müziği / ambient YouTube videoları için **yerel** üretim paneli. Her şey kendi bilgisayarında
çalışır: bulut, GitHub ve YouTube API kullanılmaz. Sistem videoyu ve dosyaları hazırlar, YouTube
Studio'ya yüklemeyi sen elle yaparsın.

## En kolay yol (Windows)

1. `KUR.bat` dosyasına çift tıkla. Node.js ve FFmpeg yoksa kurar, paketleri yükler, veritabanını hazırlar.
   "Yeni kuruldu ama göremiyor" mesajı çıkarsa pencereyi kapatıp bir kez daha çift tıkla.
2. `BASLAT.bat` dosyasına çift tıkla. Panel tarayıcıda açılır: http://127.0.0.1:3000
   BASLAT.bat önce açık kalmış eski panel/worker süreçlerini kapatır. Durdurmak için `DURDUR.bat`.

Aşağıdaki bölümler aynı işi elle yapmak isteyenler içindir.

## Gereksinimler (Windows)

1. **Node.js 22.13 veya üstü** (önerilen: 24 LTS) — https://nodejs.org adresinden "LTS" sürümünü kur.
   Kurulumdan sonra yeni bir terminalde `node -v` yazarak kontrol et.
2. **FFmpeg** — PowerShell'de tek komutla kurulur:

   ```powershell
   winget install Gyan.FFmpeg
   ```

   Kurulumdan sonra terminali kapatıp yeniden aç ve `ffmpeg -version` ile kontrol et. Alternatif
   olarak FFmpeg'i elle indirip `.env` içinde `FFMPEG_PATH` değerini ayarlayabilirsin
   (örnek: `C:\ffmpeg\bin\ffmpeg.exe`).

## Kurulum

Proje klasöründe (`D:\iş\omyrava-studio`) bir terminal aç (PowerShell veya CMD):

```powershell
npm install
copy .env.example .env
npm run migrate
```

## Çalıştırma

İki parça var: **panel** (web arayüzü) ve **worker** (arka planda render yapan işçi).

```powershell
npm run dev:all
```

Sonra tarayıcıda http://127.0.0.1:3000 adresini aç. Panel yalnızca bu bilgisayardan erişilebilir.

İstersen ikisini ayrı terminallerde de başlatabilirsin: `npm run dev` ve `npm run worker`.

### Tam otomatik üretim (önerilen yol)

Hiçbir dosya yüklemen gerekmez; yapay zekâ kullanılmaz, her şey sistem tarafından üretilir.

1. Ana sayfada proje oluştur ("Oluşturunca her şeyi otomatik hazırla" işaretli kalsın).
2. Sistem kategoriye göre hazırlar: birkaç farklı ses varyasyonu + uzun karışım, hareketli
   görüntü (yıldızlı gökyüzü, gece, yağmur, kar, sis), 2 dakikalık önizleme, kapak, başlık/açıklama.
3. Önizlemeyi izle. Beğendiysen **"Beğendim: tam render + yükleme paketi"**, beğenmediysen
   **"Baştan farklı üret"**.
4. Paket hazır olunca **Onayla**, videoyu YouTube Studio'ya yükle, bağlantıyı panele kaydet.

| Kategori   | Ses                                      | Görüntü             |
| ---------- | ---------------------------------------- | ------------------- |
| Deep Sleep | 4 drone + altta kahverengi gürültü       | Sakin gece gökyüzü  |
| Rain       | 2 hafif + 1 yoğun yağmur                 | Yağmurlu gece       |
| Meditation | 4 pad akor + altta hafif yağmur          | Yumuşak sis ve ışık |
| Cosmic     | 3 drone + 1 pad                          | Yıldızlı gökyüzü    |
| Piano      | 4 pad (piyano için yapay zekâ henüz yok) | Sakin gece gökyüzü  |

Elle ayar yapmak istersen proje sayfasının altındaki **Gelişmiş** bölümünü aç.

### Yapay zekâ müziği (Stable Audio 3, isteğe bağlı)

Kuruluysa müzik kategorilerinde (Deep Sleep, Cosmic, Meditation, Piano, Piano & Violin, Nordic, Strings)
otomatik üretim müziği bilgisayardaki ekran kartıyla yapay zekâ üretir; kurulu değilse ya da hata olursa
yerleşik besteciye geçer. Kurulum: `ai\YAPAY-ZEKA-KURULUM.txt` adımları, sonra `AI-KUR.bat`.
Yapay zekâ kullanıldığında açıklamaya yapay zekâ beyanı otomatik eklenir.

### Yapay zekâ 4K görsel (FLUX.1-schnell, isteğe bağlı)

Kuruluysa otomatik üretim kategoriye uygun bir sahne seçer (yağmurlu pencere, fiyort ve kuzey
ışıkları, karlı orman, sisli göl, ay ışığında okyanus, Samanyolu...), ekran kartında FLUX.1-schnell
(Apache-2.0) ile kareyi üretir, Real-ESRGAN ile 3840×2160'ya büyütür ve üstüne FFmpeg ile hafif
hareket ekler: 60 sn'de gidip gelen %2,5'lik yakınlaşma ve sahneye göre yağmur, kar, sis, yıldız
pırıltısı ya da su yansıması. Döngü kusursuzdur; 4K render onu yeniden kodlamadan uzatır.
Kurulu değilse yerleşik FFmpeg görselleri kullanılır. Kurulum: `ai\GORSEL-KURULUM.txt`, sonra
`GORSEL-KUR.bat` (ayrı Python ortamı `ai\.venv-img`, ~25 GB indirme).

4K dosya boyutu: hareketsiz sahnelerde saatte ~2 GB, yağmurlu sahnelerde saatte ~5–6 GB.

### Büyüme araçları

- **Karanlık ekran:** "Beğendim: tam render" düğmesinin yanındaki seçimle görüntü 10-60 dk sonra
  8 sn'de kararır, ses devam eder (yeniden kodlamadan). Başlığa "Dark Screen" eklenir.
- **Shorts:** paket klasöründe `short.mp4` (30 sn, 1080×1920) ve `short-baslik.txt`. Uzun videoyu
  yükledikten sonra bağlantısını Shorts açıklamasına yapıştır.
- **Kapak testi:** `kapak.jpg`, `kapak-2.jpg`, `kapak-3.jpg` farklı düzenlerde; YouTube Studio'da
  "Test & compare" ile dene.
- **Çeşitlilik koruması:** son kullanılan yapay zekâ sahneleri tekrarlanmaz, başlık kalıbı döner,
  aynı kategoride 48 saat içinde ikinci video hazırlanınca uyarı verir.
- **Kanal panosu** (`/istatistik`): yüklenen videoların YouTube Studio rakamlarını elle gir; tür ve
  sahne bazında özet ve öneri.
- **Bakım** (`/bakim`): günlük otomatik veritabanı yedeği (`data\yedek`, son 14) ve eski ara
  dosyaların temizliği; disk kullanımı.

### Besteci (müzik)

Yapay zekâ kullanmadan, müzik kurallarıyla (mod/gam, akor dizileri, motif tekrarı ve varyasyonu,
giriş–ana bölüm–kapanış, dinamik ve insansı zamanlama) beste yapar ve gerçek enstrüman
örnekleriyle çalar. Enstrüman sesleri: `soundfonts/FluidR3_GM.sf2` (Frank Wen, MIT lisansı;
bkz. `soundfonts/FluidR3_GM-LICENSE.txt`).

- **İskandinav / Viking:** Dorian/Aeolian mod, kontrbas + çello bordun, koro, ağır davul (taiko),
  keman melodisi, ara sıra korno.
- **Solo piyano:** arpej eşlik, sağ elde sade melodi, pedal.
- **Piyano ve keman:** piyano eşlik, keman melodisi, altta çok hafif yaylılar.
- **Yaylılar ve çello:** yaylı akorlar, çello melodisi, kontrbas.

Her parça farklı bir tohumla (seed) bestelenir; 15 dakikalık parça birkaç bölüme ayrılır ve
bölümler arasında tonalite değişebilir.

### Stüdyo: ses ve görüntü (Gelişmiş)

Proje sayfasının en üstündeki **Ses stüdyosu** yapay zekâ kullanmadan, FFmpeg ile sıfırdan ses üretir:

- Türler: yağmur (hafif/yoğun), okyanus dalgaları, kahverengi/pembe gürültü, derin drone, yumuşak pad akorları.
- Her varyasyon farklı bir rastgele tohumla (seed) üretilir; aynı tohum aynı sesi verir. Ses −18 LUFS'a
  ayarlanır, tepe −2 dBTP'yi geçmez. Lisans kaydı otomatik eklenir ("kendi üretimim, yapay zekâ yok").
- **Uzun karışım:** birden fazla parçayı (üretilen veya yüklenen) sırayla, yumuşak geçişlerle birleştirir;
  isteğe bağlı olarak tüm süre boyunca altta bir katman (örn. yağmur) çalar ve sonucu normalize eder.
  Tekrarı azaltmak için birkaç varyasyon üretip karıştır, sonra render'da bu karışımı seç.
- Sadece lisansı onaylı parçalar karıştırılabilir; karışımın lisans kaydı kaynakları listeler.

### Üretilen dosyalar (Gelişmiş)

- Dosya yükleme alanları kaldırıldı; tüm dosyaları sistem üretir. (Gerekirse API ile yükleme hâlâ mümkün.)
- Her dosya `data\assets\<proje>\` içine kopyalanır, SHA-256 özeti alınır ve worker otomatik analiz eder:
  - **Ses:** ses seviyesi (LUFS), tepe (dBTP), dalgalanma (LRA), clipping, sessiz bölümler.
  - **Görsel / video:** çözünürlük, 16:9 oranı, kapak için 2 MB sınırı.
- **Normalize et:** sesi −18 LUFS'a getirir, tepeyi −2 dBTP'de tutar, 5 sn fade-in / 10 sn fade-out ekler.
  Sonuç yeni bir FLAC dosyası olarak eklenir; orijinal korunur.
- **Lisans:** her varlık için kaynak, lisans türü, kanıt ve "kontrol ettim" işareti. Lisansı onaylanmamış
  varlık varken ya da projede ses yokken proje **Onaylandı** durumuna geçemez.

### Render (uzun video)

Proje sayfasındaki **Render** bölümünden ses ve görüntüyü seç:

- **Görüntü** bir video döngü (mp4/mov/webm) ya da bir görsel olabilir. Görselde "çok yavaş kayma"
  seçilirse 60 saniyede bir tur atan, fark edilmeyecek kadar yavaş bir hareket eklenir. Video döngüde
  "kusursuz" seçeneği, döngünün sonunu başına 1 saniyelik çapraz geçişle bağlar.
- **Ses** hedef süreden kısaysa sonu başına 5 saniyelik çapraz geçişle bağlanıp tekrarlanır. Videonun
  başına 5 sn fade-in, sonuna 10 sn fade-out eklenir.
- **Önizleme (2 dk)** ile kontrol et, sonra **Tam render** al. Video `output\<proje>\video-8saat-xxxx.mp4`
  olarak yazılır (H.264 1080p30 + AAC 192 kbps).
- Nasıl çalışır: görüntü döngüsü bir kez kodlanır, sonra yeniden kodlanmadan hedef süreye uzatılır.
  Bu yüzden 10 saatlik video saatler değil dakikalar sürer; en uzun adım sesin AAC'ye kodlanmasıdır.
- Worker kapanırsa render, tamamlanan adımları atlayarak kaldığı yerden devam eder.
- Kontroller: siyah kare, ani görüntü geçişi, süre, akışlar, döngü sınırında çözme hatası, disk alanı.
- Tam render başlayınca proje "Render", başarıyla bitince "Hazır" olur; kontrol başarısızsa "QA başarısız".

### Yayın paketi ve YouTube

Proje sayfasındaki **Yayın paketi** bölümü:

1. **Başlık, açıklama, etiketler:** "Şablondan doldur" (İngilizce/Türkçe) ile başla, sonra düzenle.
   Kontroller: başlık ≤100, açıklama ≤5000, etiketler ≤500 karakter, `<` `>` yasak, 15'ten fazla hashtag
   uyarısı, tıbbi/kanıtsız iddialar (tedavi eder, iyileştirir, 528Hz şifa, garanti, mucize…) hata,
   yapay zekâ kullanıldıysa açıklamada belirtilmesi, aynı başlığın başka projede olması.
2. **Kapak:** görsel veya video karesinden 1280×720 JPG (en fazla 2 MB), isteğe bağlı 2 satır yazı.
   Hazır kapağın varsa Varlıklar'dan "kapak olarak" yükle.
3. **Paket:** "Yükleme paketini hazırla" → video klasörüne `baslik-aciklama.txt` (başlık, açıklama,
   etiketler ve yükleme kontrol listesi), `lisanslar.txt` ve `kapak.jpg` yazılır.
4. Proje **Onaylandı** durumuna geçer (ses, onaylı lisanslar, tam render, hatasız metaveri ve kapak şart).
5. Videoyu YouTube Studio'ya **elle** yükle, sonra panelde "YouTube'a yükledim" formuna bağlantıyı gir.
   Plan tarihi girersen proje "Planlandı", herkese açık seçersen "Yayında" olur.

### İlk test

1. Panelde bir proje oluştur.
2. Proje sayfasında **Örnek render başlat** düğmesine bas.
3. Birkaç saniye içinde iş "Tamamlandı" olur; 10 saniyelik test videosu
   `output\<proje-adı>\` klasörüne yazılır.

## Komutlar

| Komut               | Ne yapar                               |
| ------------------- | -------------------------------------- |
| `npm run dev:all`   | Panel + worker birlikte                |
| `npm run dev`       | Sadece panel (geliştirme modu)         |
| `npm run worker`    | Sadece worker                          |
| `npm run migrate`   | Veritabanı şemasını günceller          |
| `npm test`          | Testleri çalıştırır                    |
| `npm run lint`      | Kod kontrolü (ESLint)                  |
| `npm run typecheck` | TypeScript tip kontrolü                |
| `npm run format`    | Kodu Prettier ile biçimlendirir        |
| `npm run build`     | Üretim derlemesi; ardından `npm start` |

## Klasörler

```
migrations/      SQL şema dosyaları (sırayla bir kez uygulanır)
scripts/         migrate ve dev-all yardımcıları
src/app/         Next.js panel sayfaları ve API uçları
src/lib/         veritabanı, durum makinesi, iş kuyruğu, FFmpeg
src/worker/      arka plan işçisi ve iş tipleri
tests/           birim ve entegrasyon testleri
docs/            mimari ve karar notları
data/            SQLite veritabanı (otomatik oluşur, yedeklenmeli)
output/          hazır videolar (otomatik oluşur)
```

## API uçları

| Yöntem / Yol                           | İşlem                         |
| -------------------------------------- | ----------------------------- |
| `GET  /api/health`                     | Sağlık ve kuyruk durumu       |
| `GET  /api/projects`                   | Proje listesi                 |
| `POST /api/projects`                   | Proje oluştur                 |
| `POST /api/projects/:id/sample-render` | Örnek render işini kuyruğa al |
| `GET  /api/jobs/:id`                   | İş durumu ve logları          |

## Notlar

- Veritabanı `data\omyrava.db` dosyasıdır; düzenli yedeğini al.
- Node'un yerleşik SQLite modülü kullanılır; başlangıçta görülen "ExperimentalWarning" uyarısı normaldir.
- Worker kapanırsa yarım kalan işler bir sonraki açılışta tekrar kuyruğa alınır.
