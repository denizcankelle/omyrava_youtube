/**
 * Haftalik yayin plani: haftada 3 yukleme (Sali, Persembe, Cumartesi). Kanal panosundaki
 * izlenme verisine gore en iyi tur one cikar; ayni tur ust uste gelmez, denenmemis bir tur
 * de haftada bir denenir. Veri yokken sabit bir rotasyon kullanilir.
 */
import type { DB } from "./db";
import { CATEGORIES } from "./projects";
import { summarize } from "./stats";

export type Category = keyof typeof CATEGORIES;

const ROTATION: Category[] = [
  "deep_sleep",
  "nordic",
  "rain",
  "dark_blues",
  "piano",
  "ocean",
  "lofi",
];
const UPLOAD_DAYS = [2, 4, 6]; // Sali, Persembe, Cumartesi

/** Ture gore onerilen sure (saat) ve ekran kararmasi (dk). */
export const CATEGORY_DEFAULTS: Record<Category, { hours: 1 | 3 | 8 | 10; dark: number }> = {
  deep_sleep: { hours: 8, dark: 20 },
  rain: { hours: 8, dark: 20 },
  meditation: { hours: 3, dark: 0 },
  cosmic: { hours: 8, dark: 20 },
  piano: { hours: 8, dark: 20 },
  piano_violin: { hours: 3, dark: 0 },
  nordic: { hours: 3, dark: 0 },
  strings: { hours: 3, dark: 0 },
  ocean: { hours: 8, dark: 20 },
  lofi: { hours: 3, dark: 0 },
  dark_blues: { hours: 1, dark: 0 },
};

export interface PlanItem {
  date: string; // YYYY-MM-DD
  category: Category;
  label: string;
  hours: number;
  dark: number;
  reason: string;
}

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Son hazirlanan/yuklenen turler (en yeni once). */
export function recentCategories(db: DB, limit = 6): Category[] {
  return (
    db
      .prepare(
        `SELECT p.category FROM projects p LEFT JOIN project_metadata m ON m.project_id = p.id
         WHERE p.status != 'cancelled' ORDER BY COALESCE(m.packaged_at, p.created_at) DESC, p.rowid DESC LIMIT ?`,
      )
      .all(limit) as { category: Category }[]
  ).map((r) => r.category);
}

export function weeklyPlan(db: DB, now = new Date()): PlanItem[] {
  const s = summarize(db);
  const ranked = s.byCategory.map((r) => r.key as Category);
  const untried = ROTATION.filter((c) => !ranked.includes(c));
  const recent = recentCategories(db);
  const slots: { cat: Category; reason: string }[] = [];
  const take = (pool: Category[], reason: string) => {
    const prev = slots.at(-1)?.cat ?? recent[0];
    const c = pool.find((x) => x !== prev && !slots.some((sl) => sl.cat === x));
    if (c) slots.push({ cat: c, reason });
    return Boolean(c);
  };
  if (ranked.length >= 2) {
    take(ranked, "en çok izlenme süresi getiren tür");
    take(untried.length ? untried : ranked.slice(2), "yeni tür denemesi");
    take(ranked, "ikinci en iyi tür");
  }
  // Veri yoksa ya da eksik kaldiysa: son yapilanlardan uzak rotasyon
  const byAge = [...ROTATION].sort((a, b) => {
    const ia = recent.indexOf(a);
    const ib = recent.indexOf(b);
    // Hic yapilmamis tur once, sonra en eski yapilan; en son yapilan en sona
    return (ia === -1 ? -99 : -ia) - (ib === -1 ? -99 : -ib);
  });
  while (slots.length < 3 && take(byAge, "sıra (uzun süredir yapılmayan tür)")) {
    /* doldur */
  }
  // Tarihler: bugunden sonraki ilk uc yukleme gunu
  const dates: Date[] = [];
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  while (dates.length < slots.length) {
    d.setDate(d.getDate() + 1);
    if (UPLOAD_DAYS.includes(d.getDay())) dates.push(new Date(d));
  }
  return slots.map((sl, i) => ({
    date: ymd(dates[i]),
    category: sl.cat,
    label: CATEGORIES[sl.cat],
    hours: CATEGORY_DEFAULTS[sl.cat].hours,
    dark: CATEGORY_DEFAULTS[sl.cat].dark,
    reason: sl.reason,
  }));
}
