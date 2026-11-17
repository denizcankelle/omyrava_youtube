/**
 * Yerlesik gorsel/video dongu uretimi (yapay zekasiz, FFmpeg). Her uretim bir seed ile
 * belirlenir. Ciktilar calisma klasorunde goreli adlarla uretilir (Windows yol kacisi yok):
 *  - still.png : 1920x1080 temsil karesi (kapak kaynagi)
 *  - loop.mp4  : kusursuz donen 1080p30 video
 */
import { z } from "zod";
import { rng } from "./synth";

export const VISUAL_PRESETS = {
  starry_sky: { label: "Yıldızlı gökyüzü", en: "Starry Night Sky" },
  night_sky: { label: "Sakin gece gökyüzü", en: "Calm Night Sky" },
  rain_window: { label: "Yağmurlu gece", en: "Rainy Night" },
  snow: { label: "Yağan kar", en: "Gentle Snowfall" },
  mist: { label: "Yumuşak sis ve ışık", en: "Soft Mist" },
  aurora: { label: "Kuzey ışıkları", en: "Northern Lights" },
} as const;

export type VisualPreset = keyof typeof VISUAL_PRESETS;

export const visualSchema = z.object({
  projectId: z.string().min(1),
  preset: z.enum(Object.keys(VISUAL_PRESETS) as [VisualPreset, ...VisualPreset[]]),
});

const FPS = 30;
const X264 = [
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-maxrate",
  "8M",
  "-bufsize",
  "16M",
  "-bf",
  "0",
  "-g",
  "60",
  "-keyint_min",
  "60",
  "-sc_threshold",
  "0",
  "-r",
  String(FPS),
  "-pix_fmt",
  "yuv420p",
  "-an",
  "-movflags",
  "+faststart",
];

const PALETTES: Record<
  "sky" | "night" | "rain" | "snow" | "mist" | "aurora",
  readonly (readonly string[])[]
> = {
  sky: [
    ["0x03040c", "0x2a1250", "0x0d3a5c"],
    ["0x02050d", "0x123a5a", "0x2b1a4a"],
    ["0x04030a", "0x3a1440", "0x101c48"],
    ["0x020608", "0x0c3a40", "0x1a2050"],
  ],
  night: [
    ["0x02030a", "0x0d1838", "0x1c2a5c"],
    ["0x030208", "0x1a1238", "0x2a2058"],
    ["0x02060a", "0x0a2230", "0x153a4a"],
  ],
  rain: [
    ["0x06090e", "0x18242e", "0x26343e"],
    ["0x07080c", "0x1c1f2a", "0x2c3040"],
  ],
  snow: [
    ["0x0a0e18", "0x1c2638", "0x2c3a50"],
    ["0x0c0c14", "0x22223a", "0x343a56"],
  ],
  aurora: [
    ["0x02060a", "0x0d5a40", "0x1a2a5a"],
    ["0x03050c", "0x147a50", "0x2a1a50"],
    ["0x020408", "0x0a6a5a", "0x103050"],
  ],
  mist: [
    ["0x0a0c14", "0x2c2a4a", "0x2a4a50"],
    ["0x0c0a10", "0x3a2a40", "0x284050"],
    ["0x080c10", "0x203c44", "0x3a3a5a"],
  ],
};

/** Tohumlu tekduze gurultu (gri, 0x80 etrafinda ~76..177). */
function noiseSrc(w: number, h: number, seed: number) {
  return `color=c=0x808080:s=${w}x${h}:d=1,format=gray,noise=alls=100:allf=u:all_seed=${seed}`;
}

/**
 * Seyrek nokta katmani (gri PNG): iki bagimsiz gurultu esiginin kesisimi; parlaklik ucuncu
 * bir gurultuden gelir. `shape` bulanıklık/uzatma filtreleri, `gain` parlaklik carpani.
 */
function dotLayer(
  w: number,
  h: number,
  seeds: [number, number, number],
  tA: number,
  tB: number,
  shape: string,
  gain: number,
  out: string,
): string[] {
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    noiseSrc(w, h, seeds[0]),
    "-f",
    "lavfi",
    "-i",
    noiseSrc(w, h, seeds[1]),
    "-f",
    "lavfi",
    "-i",
    noiseSrc(w, h, seeds[2]),
    "-filter_complex",
    `[0]lut=y='if(gte(val,${tA}),255,0)'[a];[1]lut=y='if(gte(val,${tB}),255,0)'[b];` +
      `[a][b]blend=all_mode=multiply[m];[m][2]blend=all_mode=multiply,${shape},lut=y='min(255,val*${gain})'`,
    "-frames:v",
    "1",
    "-pix_fmt",
    "gray",
    out,
  ];
}

/** Iki gri katmani en parlak olani alarak birlestirir. */
function lighten(a: string, b: string, out: string): string[] {
  return [
    "-y",
    "-i",
    a,
    "-i",
    b,
    "-filter_complex",
    "[0][1]blend=all_mode=lighten",
    "-pix_fmt",
    "gray",
    out,
  ];
}

/** Kucuk boyutta bulanik gradyan, hedef boyuta buyutulur (hizli ve puruzsuz). */
function softGradient(
  w: number,
  h: number,
  colors: readonly string[],
  type: string,
  seed: number,
  blur: number,
) {
  const sw = Math.round(w / 4);
  const sh = Math.round(h / 4);
  const g = `gradients=s=${sw}x${sh}:${colors.map((c, i) => `c${i}=${c}`).join(":")}:nb_colors=${colors.length}:type=${type}:seed=${seed}:d=1`;
  return `${g},format=gbrp,gblur=sigma=${blur},scale=${w}:${h}:flags=bicubic`;
}

/** Arka plan: iki yumusak gradyanin ortalamasi, hafif koyulastirma ve titresim onleyici gren. */
function background(
  w: number,
  h: number,
  a: string,
  b: string,
  darken: number,
  out: string,
): string[] {
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    a,
    "-f",
    "lavfi",
    "-i",
    b,
    "-filter_complex",
    `[0][1]blend=all_mode=lighten,curves=all='0/0 1/${darken}',noise=alls=3,format=rgb24`,
    "-frames:v",
    "1",
    out,
  ];
}

/** Gri isik katmanini (alfa olarak) beyaz renkle arka planin uzerine bindirir. */
function composite(bg: string, light: string, w: number, h: number, out: string): string[] {
  return [
    "-y",
    "-i",
    bg,
    "-i",
    light,
    "-f",
    "lavfi",
    "-i",
    `color=c=white:s=${w}x${h}:d=1`,
    "-filter_complex",
    "[2]format=rgba[w];[1]format=gray[al];[w][al]alphamerge[l];[0][l]overlay=format=auto,format=rgb24",
    "-frames:v",
    "1",
    out,
  ];
}

export interface VisualPlan {
  preset: VisualPreset;
  seed: number;
  /** Sirayla calistirilacak ffmpeg komutlari (calisma klasorunde). */
  steps: string[][];
  loopSec: number;
  description: string;
}

/** Hareketli kirpma (60 sn periyot) ile buyuk gorselden kusursuz dongu. */
function driftLoop(input: string, P = 60): string[] {
  const vf =
    `crop=3840:2160:x='192+192*sin(2*PI*t/${P})':y='108+108*sin(4*PI*t/${P})',` +
    `scale=1920:1080:flags=bicubic,setsar=1,format=yuv420p`;
  return [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-i",
    input,
    "-t",
    String(P),
    "-vf",
    vf,
    ...X264,
    "loop.mp4",
  ];
}

function centerStill(input: string): string[] {
  return [
    "-y",
    "-i",
    input,
    "-vf",
    "crop=3840:2160,scale=1920:1080:flags=lanczos",
    "-frames:v",
    "1",
    "still.png",
  ];
}

export function buildVisualPlan(preset: VisualPreset, seed: number): VisualPlan {
  const r = rng(seed);
  const s = (n: number) => (seed * 13 + n * 7919) % 2147483647;
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
  const W = 4224;
  const H = 2376;

  if (preset === "starry_sky" || preset === "night_sky" || preset === "aurora") {
    const pal = pick(
      preset === "starry_sky"
        ? PALETTES.sky
        : preset === "aurora"
          ? PALETTES.aurora
          : PALETTES.night,
    );
    const dense = preset !== "night_sky";
    const steps = [
      dotLayer(
        W,
        H,
        [s(1), s(2), s(3)],
        dense ? 171 : 172,
        dense ? 169 : 171,
        "gblur=sigma=1.2",
        4,
        "small.png",
      ),
      dotLayer(
        W,
        H,
        [s(4), s(5), s(6)],
        174,
        dense ? 173 : 174,
        "gblur=sigma=3.5",
        10,
        "bright.png",
      ),
      lighten("small.png", "bright.png", "stars.png"),
      background(
        W,
        H,
        preset === "aurora"
          ? softGradient(W, H, [pal[0], pal[1], pal[0], pal[1], pal[2], pal[0]], "linear", s(7), 30)
          : softGradient(W, H, pal, dense ? "radial" : "linear", s(7), 45),
        softGradient(W, H, [pal[0], pal[2], pal[0]], "linear", s(8), 45),
        0.75,
        "bg.png",
      ),
      composite("bg.png", "stars.png", W, H, "big.png"),
      centerStill("big.png"),
      driftLoop("big.png"),
    ];
    return {
      preset,
      seed,
      steps,
      loopSec: 60,
      description: `${VISUAL_PRESETS[preset].label}, renkler ${pal.join("/")}`,
    };
  }

  if (preset === "mist") {
    const pal = pick(PALETTES.mist);
    const steps = [
      background(
        W,
        H,
        softGradient(W, H, [pal[0], pal[1], pal[0], pal[2]], "radial", s(1), 60),
        softGradient(W, H, [pal[0], pal[2], pal[1]], "spiral", s(2), 60),
        0.9,
        "big.png",
      ),
      centerStill("big.png"),
      driftLoop("big.png"),
    ];
    return {
      preset,
      seed,
      steps,
      loopSec: 60,
      description: `Sis ve ışık, renkler ${pal.join("/")}`,
    };
  }

  // Yagmur ve kar: sabit arka plan + dikey kayan (scroll) parcacik katmanlari.
  // Hizlar periyodu tam bolecek sekilde secilir; dongu kusursuzdur.
  const rain = preset === "rain_window";
  const pal = pick(rain ? PALETTES.rain : PALETTES.snow);
  const w = 1920;
  const h = 1080;
  const P = rain ? 12 : 30;
  const frames = FPS * P;
  const k1 = rain ? 8 : 2;
  const k2 = rain ? 5 : 3;
  const steps = [
    background(
      w,
      h,
      softGradient(w, h, [pal[0], pal[1], pal[2], pal[0]], "linear", s(1), 40),
      softGradient(w, h, [pal[0], pal[2], pal[0]], "radial", s(2), 40),
      0.85,
      "bg.png",
    ),
    rain
      ? dotLayer(
          w,
          h,
          [s(3), s(4), s(5)],
          171,
          168,
          "avgblur=sizeX=1:sizeY=30,gblur=sigma=0.7",
          9,
          "l1.png",
        )
      : dotLayer(w, h, [s(3), s(4), s(5)], 173, 172, "gblur=sigma=2.2", 10, "l1.png"),
    rain
      ? dotLayer(w, h, [s(6), s(7), s(8)], 172, 170, "avgblur=sizeX=1:sizeY=18", 5, "l2.png")
      : dotLayer(w, h, [s(6), s(7), s(8)], 174, 174, "gblur=sigma=4.5", 18, "l2.png"),
    [
      "-y",
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      "bg.png",
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      "l1.png",
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      "l2.png",
      "-f",
      "lavfi",
      "-i",
      `color=c=white:s=${w}x${h}:r=${FPS}`,
      "-filter_complex",
      `[1]format=gray,scroll=vertical=-${(k1 / frames).toFixed(8)}[a1];` +
        `[2]format=gray,scroll=vertical=-${(k2 / frames).toFixed(8)}${rain ? "" : `:horizontal=${(1 / frames).toFixed(8)}`}[a2];` +
        `[a1][a2]blend=all_mode=lighten,lut=y='val*${rain ? 0.75 : 0.95}'[al];` +
        `[3]format=rgba[wh];[wh][al]alphamerge[p];` +
        `[0]format=rgb24[b];[b][p]overlay=format=auto:shortest=1,setsar=1,format=yuv420p`,
      "-t",
      String(P),
      ...X264,
      "loop.mp4",
    ],
    ["-y", "-ss", "1", "-i", "loop.mp4", "-frames:v", "1", "still.png"],
  ];
  return {
    preset,
    seed,
    steps,
    loopSec: P,
    description: `${VISUAL_PRESETS[preset].label}, ${P} sn kusursuz döngü`,
  };
}
