/**
 * YouTube metaverisi: sablondan oneriler ve dogrulama. Saf fonksiyonlar.
 * Tibbi iddia ve kanitsiz "frekans" vaatleri engellenir (proje dokumani 11).
 */
import { z } from "zod";

export type Lang = "en" | "tr";
type Category =
  | "deep_sleep"
  | "rain"
  | "meditation"
  | "cosmic"
  | "piano"
  | "piano_violin"
  | "nordic"
  | "strings"
  | "ocean"
  | "lofi"
  | "dark_blues";

export const YT_LIMITS = {
  title: 100,
  description: 5000,
  tagsTotal: 500,
  hashtagsMax: 15,
};

const CAT: Record<
  Category,
  Record<Lang, { title: string; noun: string; tags: string[]; hashtags: string[] }>
> = {
  deep_sleep: {
    en: {
      title: "Deep Sleep Music",
      noun: "calm ambient music",
      tags: [
        "deep sleep music",
        "sleep music",
        "relaxing music",
        "ambient sleep",
        "calm music",
        "dark screen sleep",
      ],
      hashtags: ["#sleepmusic", "#deepsleep", "#relaxingmusic"],
    },
    tr: {
      title: "Derin Uyku Müziği",
      noun: "sakin ambient müzik",
      tags: [
        "derin uyku müziği",
        "uyku müziği",
        "rahatlatıcı müzik",
        "sakin müzik",
        "uyku için müzik",
      ],
      hashtags: ["#uykumüziği", "#derinuyku", "#rahatlatıcımüzik"],
    },
  },
  rain: {
    en: {
      title: "Gentle Rain Sounds",
      noun: "soft rain behind the window with warm ambient music",
      tags: [
        "rain sounds",
        "rain for sleep",
        "gentle rain",
        "rain ambience",
        "relaxing rain",
        "white noise rain",
      ],
      hashtags: ["#rainsounds", "#sleepsounds", "#relaxing"],
    },
    tr: {
      title: "Yumuşak Yağmur Sesi",
      noun: "camın ardından yumuşak yağmur ve sıcak ambient müzik",
      tags: [
        "yağmur sesi",
        "uyku için yağmur sesi",
        "rahatlatıcı yağmur",
        "yağmur ambiyansı",
        "beyaz gürültü",
      ],
      hashtags: ["#yağmursesi", "#uykusesleri", "#rahatlama"],
    },
  },
  meditation: {
    en: {
      title: "Calm Meditation Music",
      noun: "slow, peaceful meditation music",
      tags: [
        "meditation music",
        "calm music",
        "relaxing music",
        "mindfulness music",
        "peaceful music",
      ],
      hashtags: ["#meditationmusic", "#calm", "#relaxingmusic"],
    },
    tr: {
      title: "Sakin Meditasyon Müziği",
      noun: "yavaş ve huzurlu meditasyon müziği",
      tags: ["meditasyon müziği", "sakin müzik", "rahatlatıcı müzik", "farkındalık müziği"],
      hashtags: ["#meditasyonmüziği", "#sakinlik", "#rahatlama"],
    },
  },
  cosmic: {
    en: {
      title: "Cosmic Ambient for Sleep",
      noun: "slow cosmic ambient soundscapes",
      tags: [
        "space ambient",
        "cosmic music",
        "space sleep music",
        "ambient space",
        "relaxing space music",
      ],
      hashtags: ["#spaceambient", "#sleepmusic", "#ambient"],
    },
    tr: {
      title: "Uyku İçin Kozmik Ambient",
      noun: "yavaş kozmik ambient ses manzaraları",
      tags: ["uzay ambient", "kozmik müzik", "uzay uyku müziği", "ambient müzik"],
      hashtags: ["#uzayambient", "#uykumüziği", "#ambient"],
    },
  },
  piano: {
    en: {
      title: "Soft Piano for Sleep",
      noun: "soft felt piano with gentle rain",
      tags: ["sleep piano", "soft piano", "relaxing piano", "calm piano music", "piano for sleep"],
      hashtags: ["#sleeppiano", "#softpiano", "#relaxingmusic"],
    },
    tr: {
      title: "Uyku İçin Yumuşak Piyano",
      noun: "yumuşak keçe piyano ve hafif yağmur",
      tags: ["uyku piyanosu", "yumuşak piyano", "rahatlatıcı piyano", "sakin piyano müziği"],
      hashtags: ["#uykupiyanosu", "#piyano", "#rahatlatıcımüzik"],
    },
  },
  piano_violin: {
    en: {
      title: "Piano & Violin for Sleep",
      noun: "gentle piano and violin music",
      tags: [
        "piano and violin",
        "relaxing violin",
        "sleep piano",
        "calm instrumental",
        "peaceful music",
      ],
      hashtags: ["#pianoandviolin", "#relaxingmusic", "#sleepmusic"],
    },
    tr: {
      title: "Uyku İçin Piyano ve Keman",
      noun: "yumuşak piyano ve keman müziği",
      tags: ["piyano ve keman", "rahatlatıcı keman", "uyku piyanosu", "sakin enstrümantal"],
      hashtags: ["#piyanovekeman", "#rahatlatıcımüzik", "#uykumüziği"],
    },
  },
  nordic: {
    en: {
      title: "Nordic Viking Ambient Music",
      noun: "slow Nordic ambient music with deep drums, strings and choir",
      tags: [
        "nordic music",
        "viking music",
        "nordic ambient",
        "scandinavian music",
        "relaxing viking music",
      ],
      hashtags: ["#nordicmusic", "#vikingmusic", "#ambient"],
    },
    tr: {
      title: "İskandinav Viking Ambient Müziği",
      noun: "derin davullar, yaylılar ve koro ile yavaş İskandinav ambient müziği",
      tags: ["iskandinav müziği", "viking müziği", "nordik ambient", "rahatlatıcı viking müziği"],
      hashtags: ["#iskandinavmüziği", "#vikingmüziği", "#ambient"],
    },
  },
  strings: {
    en: {
      title: "Warm Strings & Cello for Sleep",
      noun: "slow, warm string and cello music",
      tags: [
        "cello music",
        "relaxing strings",
        "calm cello",
        "sleep music",
        "peaceful instrumental",
      ],
      hashtags: ["#cello", "#relaxingmusic", "#sleepmusic"],
    },
    tr: {
      title: "Uyku İçin Sıcak Yaylılar ve Çello",
      noun: "yavaş ve sıcak yaylı ve çello müziği",
      tags: ["çello müziği", "rahatlatıcı yaylılar", "sakin çello", "uyku müziği"],
      hashtags: ["#çello", "#rahatlatıcımüzik", "#uykumüziği"],
    },
  },
  ocean: {
    en: {
      title: "Gentle Ocean Waves & Ambient",
      noun: "distant ocean waves with warm ambient music",
      tags: [
        "ocean waves",
        "ocean sounds for sleep",
        "waves sounds",
        "calm ocean",
        "ambient sleep music",
        "relaxing waves",
      ],
      hashtags: ["#oceanwaves", "#sleepsounds", "#ambient"],
    },
    tr: {
      title: "Sakin Okyanus Dalgaları ve Ambient",
      noun: "uzak okyanus dalgaları ve sıcak ambient müzik",
      tags: ["okyanus dalgaları", "dalga sesi", "uyku için dalga sesi", "sakin deniz sesi"],
      hashtags: ["#okyanusdalgaları", "#dalgasesi", "#uykusesleri"],
    },
  },
  lofi: {
    en: {
      title: "Drumless Lo-fi for Study & Reading",
      noun: "drumless lo-fi with warm electric piano",
      tags: [
        "lofi no drums",
        "drumless lofi",
        "lofi for studying",
        "lofi for reading",
        "chill electric piano",
        "calm lofi",
      ],
      hashtags: ["#lofi", "#studymusic", "#chill"],
    },
    tr: {
      title: "Ders ve Okuma İçin Davulsuz Lo-fi",
      noun: "sıcak elektrikli piyanolu davulsuz lo-fi",
      tags: ["lofi", "davulsuz lofi", "ders çalışma müziği", "okuma müziği", "sakin lofi"],
      hashtags: ["#lofi", "#dersçalışma", "#sakinmüzik"],
    },
  },
  dark_blues: {
    en: {
      title: "Dark Blues Instrumental",
      noun: "slow dark blues with heavy slide guitar, deep bass and brushed drums",
      tags: [
        "dark blues",
        "slow blues",
        "instrumental blues",
        "slide guitar",
        "southern gothic",
        "late night blues",
      ],
      hashtags: ["#darkblues", "#slowblues", "#slideguitar"],
    },
    tr: {
      title: "Dark Blues Enstrümantal",
      noun: "ağır slide gitar, derin bas ve fırçalı davulla yavaş dark blues",
      tags: ["dark blues", "yavaş blues", "enstrümantal blues", "slide gitar", "gece müziği"],
      hashtags: ["#darkblues", "#blues", "#slidegitar"],
    },
  },
};

export interface MetadataDraft {
  title: string;
  description: string;
  tags: string[];
}

function hoursLabel(sec: number, lang: Lang) {
  const h = Math.round((sec / 3600) * 10) / 10;
  return lang === "en" ? `${h} Hour${h === 1 ? "" : "s"}` : `${h} Saat`;
}

/** Sablondan baslangic metni. Kullanici duzenlemeli; tekrar eden icerik uyarisi icin sahne adini ekler. */
export function suggestMetadata(input: {
  category: Category;
  durationSec: number;
  scene: string;
  lang: Lang;
  aiGenerated: boolean;
  /** Baslik sablonu (ayni kategoride ust uste ayni kalip olmasin diye doner). */
  variant?: number;
}): MetadataDraft {
  const c = CAT[input.category][input.lang];
  const hrs = hoursLabel(input.durationSec, input.lang);
  const scene = input.scene.trim();
  const v = (input.variant ?? 0) % 3;
  const title = !scene
    ? `${c.title} | ${hrs}`
    : v === 1
      ? `${scene} · ${c.title} (${hrs})`
      : v === 2
        ? `${hrs} ${c.title} | ${scene}`
        : `${c.title} – ${scene} | ${hrs}`;
  if (input.lang === "en") {
    const description = [
      `${hrs} of ${c.noun}${scene ? ` with ${scene.toLowerCase()} visuals` : ""}. Made for falling asleep, resting, reading or quiet focus.`,
      "",
      "• Gentle fade-in and fade-out, no sudden sounds",
      "• Keep the volume low and use a sleep timer if you like",
      "",
      "This video is for relaxation only and is not medical advice.",
      ...(input.aiGenerated
        ? ["", "Music and/or visuals were created with the help of AI tools and edited by us."]
        : []),
      "",
      "All audio and visuals are original or used under a commercial license.",
      "",
      c.hashtags.join(" "),
    ].join("\n");
    return { title, description, tags: c.tags };
  }
  const description = [
    `${hrs} ${c.noun}${scene ? `, ${scene.toLocaleLowerCase("tr")} görüntüleriyle` : ""}. Uykuya dalmak, dinlenmek, okumak ya da sessiz odaklanma için.`,
    "",
    "• Yumuşak giriş ve çıkış, ani ses yok",
    "• Sesi kısık tutup istersen uyku zamanlayıcısı kullan",
    "",
    "Bu video yalnızca rahatlama amaçlıdır, tıbbi tavsiye değildir.",
    ...(input.aiGenerated
      ? [
          "",
          "Müzik ve/veya görüntüler yapay zekâ araçları yardımıyla üretilip tarafımızca düzenlenmiştir.",
        ]
      : []),
    "",
    "Tüm ses ve görüntüler özgündür ya da ticari lisansla kullanılmaktadır.",
    "",
    c.hashtags.join(" "),
  ].join("\n");
  return { title, description, tags: c.tags };
}

/** Kacinilacak ifadeler: tedavi/iyilestirme vaadi, kanitsiz frekans etkileri, garanti. */
const CLAIM_PATTERNS: { re: RegExp; label: string; level?: "warn" }[] = [
  { re: /\b(cure[sd]?|curing|heal(s|ing|ed)?)\b/i, label: "tedavi/iyileştirme iddiası" },
  { re: /\btreat(s|ment|ing)?\b/i, label: "“treat” tedavi gibi okunabilir", level: "warn" },
  { re: /\binsomnia\b.*\b(fix|stop|end|beat|cure)/i, label: "uykusuzluk tedavi iddiası" },
  { re: /\b(fix|stop|end|beat|cure)\b.*\binsomnia\b/i, label: "uykusuzluk tedavi iddiası" },
  {
    re: /tedavi|iyileştir|şifa|uykusuzluğu (yener|bitirir|geçirir)/i,
    label: "tedavi/iyileştirme iddiası",
  },
  { re: /\b(dna|cell|hücre)\b.*\b(repair|onar)/i, label: "biyolojik etki iddiası" },
  { re: /\b(guarantee[sd]?|garanti)/i, label: "garanti vaadi" },
  {
    re: /\b\d{2,4}\s?hz\b.*\b(heal|repair|miracle|mucize|şifa|detox)/i,
    label: "kanıtsız frekans etkisi",
  },
  { re: /\b(miracle|mucize)/i, label: "mucize iddiası" },
  {
    re: /\b(anxiety|depression|anksiyete|depresyon)\b.*\b(relief|cure|gider|tedavi)/i,
    label: "ruh sağlığı tedavi iddiası",
  },
];

export interface MetaIssue {
  level: "warn" | "error";
  field: "title" | "description" | "tags";
  message: string;
}

export function validateMetadata(m: {
  title: string;
  description: string;
  tags: string[];
  aiGenerated: boolean;
  lang: Lang;
}): MetaIssue[] {
  const out: MetaIssue[] = [];
  const t = m.title.trim();
  if (!t) out.push({ level: "error", field: "title", message: "Başlık boş" });
  if (t.length > YT_LIMITS.title)
    out.push({
      level: "error",
      field: "title",
      message: `Başlık ${t.length}/${YT_LIMITS.title} karakter`,
    });
  if (/[<>]/.test(t) || /[<>]/.test(m.description))
    out.push({
      level: "error",
      field: /[<>]/.test(t) ? "title" : "description",
      message: "YouTube < ve > karakterlerine izin vermez",
    });
  if (m.description.length > YT_LIMITS.description)
    out.push({
      level: "error",
      field: "description",
      message: `Açıklama ${m.description.length}/${YT_LIMITS.description} karakter`,
    });
  // YouTube etiket siniri: virgullerle birlikte toplam; bosluk iceren etiketler tirnakla sayilir.
  const tagsLen =
    m.tags.reduce((s, x) => s + x.length + (x.includes(" ") ? 2 : 0), 0) +
    Math.max(0, m.tags.length - 1);
  if (tagsLen > YT_LIMITS.tagsTotal)
    out.push({
      level: "error",
      field: "tags",
      message: `Etiketler ${tagsLen}/${YT_LIMITS.tagsTotal} karakter`,
    });
  const hashtags = m.description.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length > YT_LIMITS.hashtagsMax)
    out.push({
      level: "warn",
      field: "description",
      message: `${hashtags.length} hashtag var; 15'i aşınca YouTube hepsini yok sayar`,
    });
  for (const { re, label, level } of CLAIM_PATTERNS) {
    for (const [field, text] of [
      ["title", t],
      ["description", m.description],
      ["tags", m.tags.join(", ")],
    ] as const) {
      if (re.test(text))
        out.push({
          level: level ?? "error",
          field,
          message: `Kaçınılması gereken ifade (${label})`,
        });
    }
  }
  if (m.aiGenerated) {
    const mentions = /\bAI\b|yapay zek[aâ]/i.test(m.description);
    if (!mentions)
      out.push({
        level: "warn",
        field: "description",
        message:
          "Yapay zekâ kullanıldı ama açıklamada belirtilmemiş; YouTube Studio'da 'değiştirilmiş/sentetik içerik' sorusunu da işaretle",
      });
  }
  if (!/tıbbi tavsiye değildir|not medical advice/i.test(m.description))
    out.push({
      level: "warn",
      field: "description",
      message: "“Tıbbi tavsiye değildir” notu önerilir",
    });
  return dedupe(out);
}

function dedupe(list: MetaIssue[]): MetaIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.field}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[,\n]/)
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  ];
}

export const metadataSchema = z.object({
  projectId: z.string().min(1),
  language: z.enum(["en", "tr"]).default("en"),
  ytTitle: z.string().max(200).default(""),
  description: z.string().max(10000).default(""),
  tags: z.string().max(3000).default(""),
  playlist: z.string().trim().max(200).optional().or(z.literal("")),
  aiGenerated: z
    .preprocess((v) => v === "on" || v === "true" || v === true, z.boolean())
    .default(false),
});

/** YouTube baglanti/ID'sinden 11 karakterlik video kimligini cikarir. */
export function parseYoutubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /[?&]v=([\w-]{11})/,
    /\/(?:shorts|embed|live|video)\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = p.exec(s);
    if (m) return m[1];
  }
  return null;
}

/** Karanlik ekran surumu: basliga kisa ek ve aciklamaya bilgi satiri (zaten varsa degistirmez). */
export function withDarkScreen(
  m: { title: string; description: string; lang: Lang },
  minutes: number,
): { title: string; description: string } {
  const tag = m.lang === "en" ? "Dark Screen" : "Karanlık Ekran";
  const line =
    m.lang === "en"
      ? `🌙 The screen slowly fades to black after ${minutes} minutes; the sound continues.`
      : `🌙 Görüntü ${minutes} dakika sonra yavaşça kararır, ses devam eder.`;
  const title =
    m.title.includes(tag) || m.title.length + tag.length + 3 > YT_LIMITS.title
      ? m.title
      : `${m.title} | ${tag}`;
  const description = m.description.includes(line) ? m.description : `${line}\n\n${m.description}`;
  return { title, description };
}

export function categoryHashtags(category: string, lang: Lang): string[] {
  return (
    (CAT as Record<string, Record<Lang, { hashtags: string[] }>>)[category]?.[lang]?.hashtags ?? []
  );
}
