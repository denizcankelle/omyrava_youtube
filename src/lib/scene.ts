/**
 * Yapay zeka sahneleri (FLUX.1-schnell) ve 4K "yasayan resim" donguleri.
 *
 * Sahne bankasi: her sahne icin birkac istem; seed ile biri secilir. Uretilen 4K karenin
 * uzerine FFmpeg ile hafif hareket eklenir: cok yavas "nefes alan" yakinlasma ve sahneye gore
 * yagmur / kar / sis / yildiz piriltisi / su yansimasi katmani. Tum hareketler dongu
 * suresini tam bolen periyotlarla kurulur; dongu kusursuzdur ve `-c copy` ile saatlerce uzatilir.
 */
import { FPS, breathingZoom, x264For } from "./render";
import { rng } from "./synth";

export type Overlay = "rain" | "snow" | "fog" | "stars" | "water" | "none";

export interface Scene {
  label: string;
  en: string;
  overlay: Overlay;
  /** Ek katman (or. sisli gol + yildiz). */
  overlay2?: Overlay;
  prompts: string[];
}

const STYLE =
  "cinematic photograph, ultra detailed, soft natural light, calm and peaceful mood, " +
  "high dynamic range, 4k wallpaper, no people, no text";

export const SCENES = {
  rain_room: {
    label: "Yağmurlu pencere, sıcak oda",
    en: "Rainy Window",
    overlay: "rain",
    prompts: [
      "Cozy dim bedroom at night, large window with raindrops on the glass, blurred city lights outside, warm table lamp glow, soft blanket, quiet and safe",
      "Warm cozy reading nook by a big rainy window at night, rain streaks on the glass, dark forest outside, candle light and books, calm atmosphere",
      "Rainy evening seen from inside a wooden cabin, droplets on the window pane, foggy pine forest outside, warm fireplace glow inside",
    ],
  },
  rain_cabin: {
    label: "Yağmurda orman kulübesi",
    en: "Rainy Forest Cabin",
    overlay: "rain",
    overlay2: "fog",
    prompts: [
      "Small wooden cabin in a dark pine forest during gentle rain at night, warm light glowing from the windows, wet ground reflections, mist between trees",
      "Lonely Scandinavian cottage by a lake in steady rain at dusk, warm window light, misty mountains behind, moody blue tones",
    ],
  },
  lofi_desk: {
    label: "Gece masası, yağmurlu cam",
    en: "Rainy Night Desk",
    overlay: "rain",
    prompts: [
      "Cozy desk by a rainy window at night, open notebook, warm desk lamp, a cup of tea, potted plant, blurred city lights outside, lofi aesthetic, soft colors",
      "Calm late night study room, rain on the window, warm lamp light, bookshelves, a sleeping cat on the windowsill, soft lofi colors",
    ],
  },
  fjord_aurora: {
    label: "Fiyort ve kuzey ışıkları",
    en: "Fjord & Northern Lights",
    overlay: "stars",
    overlay2: "fog",
    prompts: [
      "Norwegian fjord at night with soft green northern lights over snowy mountains, still water reflecting the aurora, starry sky, serene",
      "Aurora borealis over a frozen lake in Lapland, snowy pine trees, a small wooden cabin with warm light, starry night, peaceful",
    ],
  },
  snow_forest: {
    label: "Karlı çam ormanı",
    en: "Snowy Pine Forest",
    overlay: "snow",
    prompts: [
      "Snowy pine forest at blue hour, gentle snowfall, a small wooden cabin with warm glowing windows, soft deep snow, quiet winter evening",
      "Scandinavian winter landscape at night, snow covered spruce trees, soft moonlight, light snowfall, calm and silent",
    ],
  },
  misty_lake: {
    label: "Sisli dağ gölü",
    en: "Misty Mountain Lake",
    overlay: "fog",
    prompts: [
      "Misty mountain lake at dawn, calm mirror water, pine forest on the shore, soft fog drifting over the water, pastel morning light",
      "Foggy Nordic lake at twilight, wooden pier, distant mountains, still water, soft blue and lavender tones",
    ],
  },
  ocean_moon: {
    label: "Ay ışığında sakin okyanus",
    en: "Moonlit Ocean",
    overlay: "water",
    overlay2: "stars",
    prompts: [
      "Calm ocean at night under a full moon, silver moonlight path on gentle waves, distant horizon, soft clouds, starry sky, peaceful",
      "Quiet sandy beach at night, small gentle waves, moonlight reflecting on the sea, soft clouds and stars",
    ],
  },
  ocean_dusk: {
    label: "Gün batımında kıyı",
    en: "Ocean at Dusk",
    overlay: "water",
    prompts: [
      "Peaceful ocean shore at dusk, soft pastel sunset sky, small gentle waves on the sand, warm golden light on the water",
      "Rocky Scandinavian coast at sunset, calm sea, soft pink and orange clouds, gentle waves, serene",
    ],
  },
  milky_way: {
    label: "Samanyolu ve yıldızlı gece",
    en: "Milky Way Night",
    overlay: "stars",
    prompts: [
      "The Milky Way over a calm mountain lake at night, countless stars reflected in still water, dark silhouettes of pine trees, deep blue night sky",
      "Starry night sky with the Milky Way above a quiet meadow and distant mountains, soft blue tones, peaceful",
    ],
  },
  cosmic: {
    label: "Kozmik bulutsu",
    en: "Cosmic Nebula",
    overlay: "stars",
    prompts: [
      "Deep space nebula in soft blue and purple tones, glowing clouds of gas and countless stars, calm and dreamy, astrophotography",
      "Gentle cosmic landscape, distant galaxy and soft nebula clouds, a calm planet horizon, deep blue and violet, serene space art",
    ],
  },
} satisfies Record<string, Scene>;

export type SceneId = keyof typeof SCENES;

/** Kategori -> uygun sahneler (biri seed ile secilir). */
export const CATEGORY_SCENES: Record<string, SceneId[]> = {
  rain: ["rain_room", "rain_cabin"],
  piano: ["rain_room", "rain_cabin", "misty_lake"],
  lofi: ["lofi_desk", "rain_room"],
  ocean: ["ocean_moon", "ocean_dusk"],
  deep_sleep: ["milky_way", "misty_lake", "fjord_aurora"],
  cosmic: ["cosmic", "milky_way"],
  meditation: ["misty_lake", "ocean_dusk"],
  nordic: ["fjord_aurora", "snow_forest", "misty_lake"],
  piano_violin: ["misty_lake", "snow_forest", "fjord_aurora"],
  strings: ["fjord_aurora", "misty_lake", "snow_forest"],
};

export function pickScene(category: string, seed: number): SceneId {
  const list = CATEGORY_SCENES[category] ?? ["misty_lake"];
  return list[Math.floor(rng(seed)() * list.length)];
}

/**
 * Son kullanilan sahneleri tekrar etmeyen secim: kategorinin sahnelerinden son kullanilanlar
 * cikarilir (hepsi kullanildiysa en eski kullanilan secilir). Istem de seed ile degisir.
 */
export function pickFreshScene(category: string, seed: number, recent: string[]): SceneId {
  const list = CATEGORY_SCENES[category] ?? ["misty_lake"];
  const fresh = list.filter((s) => !recent.includes(s));
  if (fresh.length) return fresh[Math.floor(rng(seed)() * fresh.length)];
  // Hepsi yakin zamanda kullanilmis: listede en eski kullanilan
  return [...list].sort((a, b) => recent.indexOf(b) - recent.indexOf(a))[0];
}

export function scenePrompt(scene: SceneId, seed: number): string {
  const r = rng(seed * 7 + 3);
  const s: Scene = SCENES[scene];
  return `${s.prompts[Math.floor(r() * s.prompts.length)]}. ${STYLE}`;
}

// ------------------------------------------------------------------ dongu plani

export const SCENE_LOOP_SEC = 60;

const f = (x: number) => x.toFixed(6);

function noise(w: number, h: number, seed: number) {
  return `color=c=0x808080:s=${w}x${h}:d=1,format=gray,noise=alls=100:allf=u:all_seed=${seed}`;
}

/** Seyrek nokta/cizgi dokusu (gri): iki gurultu esiginin kesisimi, parlaklik ucuncusunden. */
function sparseTexture(
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
    noise(w, h, seeds[0]),
    "-f",
    "lavfi",
    "-i",
    noise(w, h, seeds[1]),
    "-f",
    "lavfi",
    "-i",
    noise(w, h, seeds[2]),
    "-filter_complex",
    `[0]lut=y='if(gte(val,${tA}),255,0)'[a];[1]lut=y='if(gte(val,${tB}),255,0)'[b];` +
      `[a][b]blend=all_mode=multiply[m];[m][2]blend=all_mode=multiply,` +
      // 2x2 dosenip bulaniklastirilir, ortasi kesilir: doku her yonde kusursuz tekrar eder
      // (kayan katmanlarda kenar dikisi olmaz)
      `split[p][q];[p][q]hstack,split[r][t];[r][t]vstack,${shape},crop=${w}:${h}:${w / 2}:${h / 2},` +
      `lut=y='min(255,val*${gain})'`,
    "-frames:v",
    "1",
    "-pix_fmt",
    "gray",
    out,
  ];
}

/** Yatayda kusursuz dosenen yumusak sis dokusu (ayna dosemeli, cok bulanik). */
function fogTexture(w: number, h: number, seed: number, out: string): string[] {
  const sw = Math.round(w / 96);
  const sh = Math.round(h / 40);
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    noise(sw, sh, seed),
    "-filter_complex",
    `[0]gblur=sigma=3,split[a][b];[b]hflip[c];[a][c]hstack,` +
      `scale=${w}:${h}:flags=bicubic,gblur=sigma=${Math.round(h / 60)},` +
      `lut=y='clip((val-128)*7+90,0,255)'`,
    "-frames:v",
    "1",
    "-pix_fmt",
    "gray",
    out,
  ];
}

/** Ustten (gokyuzu) ya da alttan (su) yumusak gecisli maske. */
function bandMask(w: number, h: number, where: "top" | "bottom" | "low", out: string): string[] {
  const expr =
    where === "top"
      ? "255*clip((0.6-Y/H)/0.25,0,1)"
      : where === "bottom"
        ? "255*clip((Y/H-0.5)/0.2,0,1)"
        : "255*clip(0.35+0.65*(Y/H-0.2)/0.6,0.35,1)";
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=160x90:d=1,format=gray,geq=lum='${expr}'`,
    "-vf",
    `scale=${w}:${h}:flags=bicubic`,
    "-frames:v",
    "1",
    "-pix_fmt",
    "gray",
    out,
  ];
}

interface Layer {
  /** Hazirlik komutlari (PNG dokular). */
  prep: string[][];
  /** Girdi dosyalari (sirayla). */
  inputs: string[];
  /** Girdi etiketlerinden alfa katmani ureten filtre; {i} girdi indeksleriyle degistirilir. */
  graph: (idx: number[], out: string) => string;
  color: string;
  opacity: number;
}

function layerFor(
  kind: Overlay,
  w: number,
  h: number,
  seed: number,
  n: string,
  L: number,
): Layer | null {
  const frames = L * FPS;
  // Dongu basina tam tur sayilari: hareket hizi dongu suresinden bagimsiz kalir
  const cyc = (perSec: number) => Math.max(1, Math.round(L * perSec));
  const s = (k: number) => (seed * 31 + k * 7919) % 2147483647;
  const hw = Math.round(w / 2 / 2) * 2;
  const hh = Math.round(h / 2 / 2) * 2;
  switch (kind) {
    case "rain": {
      // Iki derinlikte ince yagmur cizgileri; hizlar donguyu tam boler (60 ve 42 tur / dongu)
      return {
        prep: [
          sparseTexture(
            hw,
            hh,
            [s(1), s(2), s(5)],
            171,
            171,
            "avgblur=sizeX=1:sizeY=26,gblur=sigma=0.7",
            14,
            `${n}a.png`,
          ),
          sparseTexture(
            hw,
            hh,
            [s(3), s(4), s(6)],
            173,
            172,
            "avgblur=sizeX=1:sizeY=40,gblur=sigma=1.4",
            10,
            `${n}b.png`,
          ),
        ],
        inputs: [`${n}a.png`, `${n}b.png`],
        graph: ([a, b], out) =>
          `[${a}]format=gray,scroll=vertical=-${f(cyc(1) / frames)}:horizontal=${f(cyc(1 / 30) / frames)},scale=${w}:${h}[${n}1];` +
          `[${b}]format=gray,scroll=vertical=-${f(cyc(0.7) / frames)}:horizontal=${f(cyc(1 / 60) / frames)},scale=${w}:${h}[${n}2];` +
          `[${n}1][${n}2]blend=all_mode=lighten[${out}]`,
        color: "0xdfe8f2",
        opacity: 0.45,
      };
    }
    case "snow": {
      return {
        prep: [
          sparseTexture(hw, hh, [s(1), s(2), s(5)], 174, 173, "gblur=sigma=1.4", 9, `${n}a.png`),
          sparseTexture(hw, hh, [s(3), s(4), s(6)], 175, 175, "gblur=sigma=3", 20, `${n}b.png`),
        ],
        inputs: [`${n}a.png`, `${n}b.png`],
        graph: ([a, b], out) =>
          `[${a}]format=gray,scroll=vertical=-${f(cyc(1 / 30) / frames)}:horizontal=${f(cyc(1 / 60) / frames)},scale=${w}:${h}[${n}1];` +
          `[${b}]format=gray,scroll=vertical=-${f(cyc(1 / 15) / frames)}:horizontal=-${f(cyc(1 / 60) / frames)},scale=${w}:${h}[${n}2];` +
          `[${n}1][${n}2]blend=all_mode=lighten[${out}]`,
        color: "0xf4f7fb",
        opacity: 0.85,
      };
    }
    case "fog": {
      return {
        prep: [
          fogTexture(w, h, s(1), `${n}a.png`),
          fogTexture(w, h, s(2), `${n}b.png`),
          bandMask(160, 90, "low", `${n}m.png`),
        ],
        inputs: [`${n}a.png`, `${n}b.png`, `${n}m.png`],
        graph: ([a, b, m], out) =>
          `[${a}]format=gray,scroll=horizontal=${f(1 / frames)}[${n}1];` +
          `[${b}]format=gray,scroll=horizontal=-${f(1 / frames)}[${n}2];` +
          `[${m}]format=gray,scale=${w}:${h}:flags=bicubic[${n}m];` +
          `[${n}1][${n}2]blend=all_mode=average[${n}f];[${n}f][${n}m]blend=all_mode=multiply[${out}]`,
        color: "0xc8d2e0",
        opacity: 0.3,
      };
    }
    case "stars":
    case "water": {
      // Piriltilar: her nokta kendi fazinda yanip soner (4 tur / dongu); dusuk cozunurlukte
      // hesaplanip buyutulur. Gokyuzu icin ust, su icin alt bant maskesi.
      const qw = Math.round(w / 4 / 2) * 2;
      const qh = Math.round(h / 4 / 2) * 2;
      const water = kind === "water";
      return {
        prep: [
          sparseTexture(
            qw,
            qh,
            [s(1), s(2), s(5)],
            water ? 169 : 173,
            water ? 169 : 173,
            water ? "avgblur=sizeX=7:sizeY=1" : "gblur=sigma=0.5",
            water ? 6 : 5,
            `${n}a.png`,
          ),
          bandMask(qw, qh, water ? "bottom" : "top", `${n}m.png`),
        ],
        inputs: [`${n}a.png`, `${n}m.png`],
        graph: ([a, m], out) =>
          `[${a}]format=gray,geq=lum='p(X,Y)*(0.55+0.45*sin(2*PI*(${cyc(1 / 15)}*N/${frames}+mod(floor(X/${water ? 8 : 3})*0.37+floor(Y/3)*0.61,1))))'[${n}t];` +
          `[${n}t][${m}]blend=all_mode=multiply,scale=${w}:${h}:flags=bicubic[${out}]`,
        color: water ? "0xf3ead8" : "0xffffff",
        opacity: water ? 0.7 : 0.5,
      };
    }
    default:
      return null;
  }
}

export interface SceneLoopPlan {
  steps: string[][];
  loopSec: number;
  description: string;
}

/**
 * `scene.png` (4K kare) -> `loop.mp4` (W x H, 60 sn kusursuz) + `still.png` (kapak icin).
 * Hareket: 60 sn'de bir gidip gelen cok hafif yakinlasma (%2.5, alt piksel hassasiyetli).
 */
export function buildSceneLoopPlan(
  scene: SceneId,
  seed: number,
  width: number,
  height: number,
  loopSec = SCENE_LOOP_SEC,
): SceneLoopPlan {
  const sc: Scene = SCENES[scene];
  const kinds = [sc.overlay, sc.overlay2].filter((k): k is Overlay => !!k && k !== "none");
  const layers = kinds
    .map((k, i) => layerFor(k, width, height, seed + i * 101, `o${i}`, loopSec))
    .filter((l): l is Layer => l !== null);
  const L = loopSec;
  const steps: string[][] = [];
  for (const l of layers) steps.push(...l.prep);

  const args: string[] = ["-y", "-loop", "1", "-framerate", String(FPS), "-i", "scene.png"];
  let idx = 1;
  let graph = `[0]scale=${width}:${height}:flags=lanczos,format=gbrp,${breathingZoom(L)}[base0];`;
  let cur = "base0";
  layers.forEach((l, li) => {
    const ids: number[] = [];
    for (const inp of l.inputs) {
      args.push("-loop", "1", "-framerate", String(FPS), "-i", inp);
      ids.push(idx++);
    }
    args.push("-f", "lavfi", "-i", `color=c=${l.color}:s=${width}x${height}:r=${FPS}`);
    const colorIdx = idx++;
    graph +=
      l.graph(ids, `al${li}`) +
      `;[al${li}]lut=y='val*${l.opacity}'[alo${li}];` +
      `[${colorIdx}]format=gbrap[c${li}];[c${li}][alo${li}]alphamerge[p${li}];` +
      `[${cur}][p${li}]overlay=format=auto:shortest=1[base${li + 1}];`;
    cur = `base${li + 1}`;
  });
  graph += `[${cur}]setsar=1,format=yuv420p[v]`;
  args.push(
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    "-t",
    String(L),
    ...x264For(height),
    "loop.mp4",
  );
  steps.push(args);
  steps.push([
    "-y",
    "-i",
    "scene.png",
    "-vf",
    "scale=1920:1080:flags=lanczos",
    "-frames:v",
    "1",
    "still.png",
  ]);
  return {
    steps,
    loopSec: L,
    description: `${sc.label} · ${kinds.length ? kinds.join(" + ") : "yalnız hareket"} · ${width}×${height}`,
  };
}
