/**
 * YouTube "Dil ekle" icin baslik ve aciklama cevirileri (Almanca, Ispanyolca, Portekizce ve
 * kaynak dilin karsiligi). Studio'da elle girilir; paket klasorune `ceviriler.txt` yazilir.
 */
type L = "de" | "es" | "pt" | "en" | "tr";

const TITLES: Record<string, Record<L, string>> = {
  deep_sleep: {
    de: "Tiefschlaf-Musik",
    es: "Música para dormir profundamente",
    pt: "Música para sono profundo",
    en: "Deep Sleep Music",
    tr: "Derin Uyku Müziği",
  },
  rain: {
    de: "Sanfter Regen & Ambient",
    es: "Lluvia suave y ambiente",
    pt: "Chuva suave e ambiente",
    en: "Gentle Rain & Ambient",
    tr: "Yumuşak Yağmur ve Ambient",
  },
  meditation: {
    de: "Ruhige Meditationsmusik",
    es: "Música tranquila para meditar",
    pt: "Música calma para meditação",
    en: "Calm Meditation Music",
    tr: "Sakin Meditasyon Müziği",
  },
  cosmic: {
    de: "Kosmische Schlafmusik",
    es: "Música cósmica para dormir",
    pt: "Música cósmica para dormir",
    en: "Cosmic Sleep Music",
    tr: "Kozmik Uyku Müziği",
  },
  piano: {
    de: "Sanftes Klavier & Regen",
    es: "Piano suave y lluvia",
    pt: "Piano suave e chuva",
    en: "Soft Piano & Rain",
    tr: "Yumuşak Piyano ve Yağmur",
  },
  piano_violin: {
    de: "Romantisches Klavier zum Einschlafen",
    es: "Piano romántico para dormir",
    pt: "Piano romântico para dormir",
    en: "Romantic Piano for Sleep",
    tr: "Uyku İçin Romantik Piyano",
  },
  nordic: {
    de: "Nordische Wikinger-Musik",
    es: "Música nórdica vikinga",
    pt: "Música nórdica viking",
    en: "Nordic Viking Music",
    tr: "İskandinav Viking Müziği",
  },
  strings: {
    de: "Warme Streicher & Cello",
    es: "Cuerdas cálidas y violonchelo",
    pt: "Cordas suaves e violoncelo",
    en: "Warm Strings & Cello",
    tr: "Sıcak Yaylılar ve Çello",
  },
  ocean: {
    de: "Sanfte Meereswellen & Ambient",
    es: "Olas del mar suaves y ambiente",
    pt: "Ondas do mar suaves e ambiente",
    en: "Gentle Ocean Waves & Ambient",
    tr: "Sakin Okyanus Dalgaları ve Ambient",
  },
  lofi: {
    de: "Lo-fi ohne Drums zum Lernen",
    es: "Lo-fi sin batería para estudiar",
    pt: "Lo-fi sem bateria para estudar",
    en: "Drumless Lo-fi for Study",
    tr: "Ders İçin Davulsuz Lo-fi",
  },
  dark_blues: {
    de: "Dark Blues Instrumental",
    es: "Dark Blues instrumental",
    pt: "Dark Blues instrumental",
    en: "Dark Blues Instrumental",
    tr: "Dark Blues Enstrümantal",
  },
};

const SLEEP = new Set([
  "deep_sleep",
  "rain",
  "meditation",
  "cosmic",
  "piano",
  "piano_violin",
  "strings",
  "ocean",
]);

function hours(sec: number, l: L): string {
  const h = Math.round((sec / 3600) * 10) / 10;
  const one = h === 1;
  return {
    de: `${h} Stunde${one ? "" : "n"}`,
    es: `${h} hora${one ? "" : "s"}`,
    pt: `${h} hora${one ? "" : "s"}`,
    en: `${h} Hour${one ? "" : "s"}`,
    tr: `${h} Saat`,
  }[l];
}

function body(category: string, l: L, ai: boolean, dark: number | null): string {
  const sleep = SLEEP.has(category);
  const use = {
    de: sleep
      ? "Zum Einschlafen, Entspannen, Lesen oder für ruhige Konzentration."
      : "Zum Arbeiten, Lesen, Autofahren oder für ruhige Abende.",
    es: sleep
      ? "Para dormir, relajarte, leer o concentrarte en calma."
      : "Para trabajar, leer, conducir o noches tranquilas.",
    pt: sleep
      ? "Para dormir, relaxar, ler ou se concentrar com calma."
      : "Para trabalhar, ler, dirigir ou noites tranquilas.",
    en: sleep
      ? "Made for falling asleep, resting, reading or quiet focus."
      : "For working, reading, driving or quiet evenings.",
    tr: sleep
      ? "Uykuya dalmak, dinlenmek, okumak ya da sessiz odaklanma için."
      : "Çalışırken, okurken, yolda ya da sakin akşamlar için.",
  }[l];
  const darkLine =
    dark === null
      ? null
      : {
          de: `🌙 Der Bildschirm wird nach ${dark} Minuten langsam dunkel; der Ton läuft weiter.`,
          es: `🌙 La pantalla se oscurece lentamente tras ${dark} minutos; el sonido continúa.`,
          pt: `🌙 A tela escurece lentamente após ${dark} minutos; o som continua.`,
          en: `🌙 The screen slowly fades to black after ${dark} minutes; the sound continues.`,
          tr: `🌙 Görüntü ${dark} dakika sonra yavaşça kararır, ses devam eder.`,
        }[l];
  const medical = sleep
    ? {
        de: "Dieses Video dient nur der Entspannung und ist kein medizinischer Rat.",
        es: "Este video es solo para relajarse y no es consejo médico.",
        pt: "Este vídeo é apenas para relaxamento e não é aconselhamento médico.",
        en: "This video is for relaxation only and is not medical advice.",
        tr: "Bu video yalnızca rahatlama amaçlıdır, tıbbi tavsiye değildir.",
      }[l]
    : null;
  const aiLine = ai
    ? {
        de: "Musik und/oder Bilder wurden mit Hilfe von KI-Werkzeugen erstellt und von uns bearbeitet.",
        es: "La música y/o las imágenes se crearon con ayuda de herramientas de IA y fueron editadas por nosotros.",
        pt: "A música e/ou as imagens foram criadas com ajuda de ferramentas de IA e editadas por nós.",
        en: "Music and/or visuals were created with the help of AI tools and edited by us.",
        tr: "Müzik ve/veya görüntüler yapay zekâ araçları yardımıyla üretilip tarafımızca düzenlenmiştir.",
      }[l]
    : null;
  return [use, darkLine, medical, aiLine].filter(Boolean).join("\n\n");
}

export const TRANSLATION_LANGS: L[] = ["de", "es", "pt"];
const LANG_NAMES: Record<L, string> = {
  de: "Almanca (Deutsch)",
  es: "İspanyolca (Español)",
  pt: "Portekizce (Português)",
  en: "İngilizce (English)",
  tr: "Türkçe",
};

export function translationsText(input: {
  category: string;
  durationSec: number;
  sourceLang: "en" | "tr";
  aiGenerated: boolean;
  darkAfterMin: number | null;
  tracklist?: string | null;
}): string {
  const langs: L[] = [input.sourceLang === "en" ? "tr" : "en", ...TRANSLATION_LANGS];
  const blocks = langs.map((l) => {
    const t = `${(TITLES[input.category] ?? TITLES.deep_sleep)[l]} | ${hours(input.durationSec, l)}`;
    const dark = input.darkAfterMin && input.darkAfterMin > 0 ? input.darkAfterMin : null;
    const desc = [body(input.category, l, input.aiGenerated, dark), input.tracklist]
      .filter(Boolean)
      .join("\n\n");
    return `=== ${LANG_NAMES[l]} ===\nBAŞLIK\n${t.slice(0, 100)}\n\nAÇIKLAMA\n${desc}\n`;
  });
  return [
    "YouTube Studio › Video › Altyazılar › Dil ekle: her dil için başlığı ve açıklamayı yapıştır.",
    "",
    ...blocks,
  ].join("\n");
}
