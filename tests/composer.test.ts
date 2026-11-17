import { describe, expect, it } from "vitest";
import { MUSIC_STYLES, type MusicStyle, composeMusic } from "../src/lib/composer";

describe("besteci", () => {
  for (const style of Object.keys(MUSIC_STYLES) as MusicStyle[]) {
    it(`${style}: belirleyici, sirali, sure icinde, notalar dogru acilip kapaniyor`, () => {
      const a = composeMusic(style, 777, 600);
      const b = composeMusic(style, 777, 600);
      const c = composeMusic(style, 778, 600);
      expect(a.events).toEqual(b.events);
      expect(JSON.stringify(a.events)).not.toEqual(JSON.stringify(c.events));
      for (let i = 1; i < a.events.length; i++)
        expect(a.events[i].t).toBeGreaterThanOrEqual(a.events[i - 1].t);
      expect(a.events.at(-1)!.t).toBeLessThanOrEqual(600);

      // Her (kanal, nota) icin acilis/kapanis sirasi tutarli olmali; ust uste acilis
      // onceki notanin kapanisini yeni notanin sesini kesecek sekilde birakmamali.
      const open = new Map<string, number>();
      let notes = 0;
      for (const e of a.events) {
        if (e.type === "on") {
          const k = `${e.ch}:${e.note}`;
          expect(open.get(k) ?? 0, `cakisan nota ${k} @${e.t}`).toBe(0);
          open.set(k, 1);
          notes++;
        } else if (e.type === "off") {
          const k = `${e.ch}:${e.note}`;
          open.set(k, 0);
        }
      }
      expect([...open.values()].every((v) => v === 0)).toBe(true);
      expect(notes).toBeGreaterThan(style === "felt_piano" ? 80 : 200);
      // Notalar duyulabilir aralikta
      for (const e of a.events) if (e.type === "on") expect(e.note).toBeGreaterThanOrEqual(24);
    });
  }
  it("kece piyano: 4–8 sn'de bir tek nota/iki nota, alt-orta oktav, yumusak, melodi yok", () => {
    const on = composeMusic("felt_piano", 5, 900).events.filter((e) => e.type === "on");
    // Bas notalari (akor degisimi) haric ust notalar
    const top = on.filter((e) => e.type === "on" && e.note >= 50);
    for (const e of top)
      if (e.type === "on") {
        expect(e.note).toBeLessThanOrEqual(69);
        expect(e.vel).toBeLessThanOrEqual(45);
      }
    // Olay gruplari: 2 sn icindeki notalar ayni motif
    const starts: number[] = [];
    for (const e of top) if (!starts.length || e.t - starts.at(-1)! > 2) starts.push(e.t);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3.3);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(19);
    const mid = gaps.filter((g) => g >= 3.5 && g <= 8.5).length / gaps.length;
    expect(mid).toBeGreaterThan(0.55);
    // Ayni anda en fazla 2 ust nota
    for (const t of starts)
      expect(top.filter((e) => e.t >= t && e.t < t + 2).length).toBeLessThanOrEqual(2);
  });

  it("lo-fi: davulsuz, elektrikli piyano, 55–65 BPM", () => {
    const m = composeMusic("lofi", 9, 600);
    expect(m.tempo).toBeGreaterThanOrEqual(55);
    expect(m.tempo).toBeLessThanOrEqual(65);
    const ev = m.events;
    expect(ev.filter((e) => e.type === "on" && e.ch === 5)).toEqual([]);
    expect(ev.find((e) => e.type === "program" && e.ch === 0)).toMatchObject({ program: 4 });
    for (const e of ev) if (e.type === "on") expect(e.vel).toBeLessThanOrEqual(60);
  });

  it("viking: davul ve koro var; piyano stilinde keman yok", () => {
    const n = composeMusic("nordic", 1, 300).events.filter((e) => e.type === "on");
    expect(n.some((e) => e.ch === 5)).toBe(true);
    expect(n.some((e) => e.ch === 4)).toBe(true);
    const p = composeMusic("piano", 1, 300).events.filter((e) => e.type === "on");
    expect(p.every((e) => e.ch === 0)).toBe(true);
  });
});
