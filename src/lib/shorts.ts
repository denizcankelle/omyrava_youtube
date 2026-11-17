/**
 * YouTube Shorts: uzun videonun 4K/1080p dongusunden 30 sn'lik dikey (1080x1920) tanitim klibi.
 * Kanala yeni dinleyici getirir; aciklamasinda uzun videonun baglantisi verilir.
 */
export const SHORT_SEC = 30;
export const SHORT_W = 1080;
export const SHORT_H = 1920;

/**
 * Calisma klasorunde `font.ttf`, `line1.txt`, `line2.txt` (baslik) ve `line3.txt` (kucuk not)
 * bulundugu varsayilir (Windows yol kacisi sorunu olmasin diye goreli adlar).
 */
export function shortArgs(input: {
  loop: string;
  audio: string;
  audioStartSec: number;
  output: string;
  titleLines: number;
  withNote: boolean;
}): string[] {
  const v = ["crop=trunc(ih*9/32)*2:ih", `scale=${SHORT_W}:${SHORT_H}:flags=lanczos`, "setsar=1"];
  const n = Math.min(2, Math.max(0, input.titleLines));
  for (let i = 0; i < n; i++)
    v.push(
      `drawtext=fontfile=font.ttf:textfile=line${i + 1}.txt:fontcolor=white:fontsize=${i === 0 ? 92 : 76}` +
        `:x=(w-text_w)/2:y=${300 + i * 120}:shadowcolor=black@0.75:shadowx=4:shadowy=4`,
    );
  if (input.withNote)
    v.push(
      "drawtext=fontfile=font.ttf:textfile=line3.txt:fontcolor=white@0.9:fontsize=48" +
        ":x=(w-text_w)/2:y=h-360:shadowcolor=black@0.75:shadowx=3:shadowy=3",
    );
  v.push(`fade=t=in:st=0:d=1`, `fade=t=out:st=${SHORT_SEC - 1.5}:d=1.5`, "format=yuv420p");
  return [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    input.loop,
    "-ss",
    input.audioStartSec.toFixed(2),
    "-i",
    input.audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-t",
    String(SHORT_SEC),
    "-vf",
    v.join(","),
    "-af",
    `afade=t=in:d=1.5,afade=t=out:st=${SHORT_SEC - 3}:d=3,loudnorm=I=-14:TP=-1.5:LRA=7,aresample=48000`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    input.output,
  ];
}

/** Shorts baslik/aciklama metni (uzun videoya yonlendirir). */
export function shortText(input: { title: string; lang: "en" | "tr"; hashtags: string[] }): {
  title: string;
  description: string;
  note: string;
} {
  const base = input.title.split(" | ")[0].trim();
  const title = `${base} #shorts`.slice(0, 100);
  const description =
    input.lang === "en"
      ? [
          `${base}. The full long version is on the channel.`,
          "Full video: (paste the link of the long video here after uploading it)",
          "",
          [...input.hashtags, "#shorts"].join(" "),
        ].join("\n")
      : [
          `${base}. Uzun versiyonu kanalda.`,
          "Tam video: (uzun videoyu yükledikten sonra bağlantısını buraya yapıştır)",
          "",
          [...input.hashtags, "#shorts"].join(" "),
        ].join("\n");
  return {
    title,
    description,
    note: input.lang === "en" ? "Full video on the channel" : "Tam video kanalda",
  };
}
