import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getConfig } from "@/lib/config";
import { findFfmpeg } from "@/lib/ffmpeg";
import { heartbeatAge } from "@/lib/heartbeat";

export const metadata: Metadata = {
  title: "Omyrava Studio",
  description: "Yerel uyku müziği ve video üretim paneli",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <div className="wrap">
          <header className="top">
            <h1>
              <Link href="/">OMYRAVA STUDIO</Link>
            </h1>
            <nav className="topnav">
              <Link href="/">Projeler</Link>
              <Link href="/plan">Yayın planı</Link>
              <Link href="/istatistik">Kanal panosu</Link>
              <Link href="/bakim">Bakım</Link>
            </nav>
          </header>
          {!findFfmpeg(getConfig().ffmpegPath) && (
            <div className="alert">
              FFmpeg bulunamadı; analiz ve render işleri çalışmaz. KUR.bat dosyasını tekrar çalıştır
              ya da FFmpeg&apos;i kurup <code>.env</code> içinde <code>FFMPEG_PATH</code> değerini
              ayarla (örnek: <code>C:\ffmpeg\bin\ffmpeg.exe</code>).
            </div>
          )}
          <WorkerBanner />
          {children}
        </div>
      </body>
    </html>
  );
}

function WorkerBanner() {
  const age = heartbeatAge(getConfig().dataDir);
  if (age !== null && age < 20_000) return null;
  return (
    <div className="alert">
      Arka plan işçisi (worker) çalışmıyor; üretim işleri sırada bekliyor. DURDUR.bat, ardından
      BASLAT.bat ile yeniden başlat. Sorun sürerse BASLAT penceresindeki son satırları gönder.
    </div>
  );
}
