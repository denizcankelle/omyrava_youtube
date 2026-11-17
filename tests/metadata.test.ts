import { describe, expect, it } from "vitest";
import { parseTags, parseYoutubeId, suggestMetadata, validateMetadata } from "../src/lib/metadata";

const base = { tags: ["rain"], aiGenerated: false, lang: "en" as const };

describe("metaveri sablonu", () => {
  it("ingilizce ve turkce oneriler kurallara uyar", () => {
    for (const lang of ["en", "tr"] as const) {
      for (const category of ["deep_sleep", "rain", "meditation", "cosmic", "piano"] as const) {
        const d = suggestMetadata({
          category,
          durationSec: 8 * 3600,
          scene: "Night Window",
          lang,
          aiGenerated: true,
        });
        const issues = validateMetadata({ ...d, aiGenerated: true, lang });
        expect(
          issues.filter((i) => i.level === "error"),
          `${lang}/${category}`,
        ).toEqual([]);
        expect(issues, `${lang}/${category}`).toEqual([]);
        expect(d.title).toMatch(/8 (Hours|Saat)/);
        expect(d.title).toContain("Night Window");
      }
    }
  });
  it("sahne bossa basliga tire eklemez", () => {
    const d = suggestMetadata({
      category: "rain",
      durationSec: 3600,
      scene: "",
      lang: "en",
      aiGenerated: false,
    });
    expect(d.title).toBe("Gentle Rain Sounds | 1 Hour");
  });
});

describe("metaveri dogrulama", () => {
  it("tibbi ve kanitsiz iddialari yakalar", () => {
    const bad = [
      "Cures insomnia in 10 minutes",
      "528Hz healing frequency DNA repair",
      "Uykusuzluğu yener, garanti",
      "Anksiyete tedavisi müziği",
      "Miracle sleep music",
    ];
    for (const title of bad) {
      const issues = validateMetadata({ ...base, title, description: "not medical advice" });
      expect(
        issues.some((i) => i.level === "error"),
        title,
      ).toBe(true);
    }
  });
  it("uzunluk ve karakter sinirlari", () => {
    const long = validateMetadata({ ...base, title: "a".repeat(101), description: "x <b>" });
    expect(long.map((i) => i.message).join("|")).toMatch(/101\/100/);
    expect(long.map((i) => i.message).join("|")).toMatch(/< ve >/);
    const tags = validateMetadata({
      ...base,
      title: "ok",
      description: "not medical advice",
      tags: Array(60).fill("relaxing music"),
    });
    expect(tags.some((i) => i.field === "tags" && i.level === "error")).toBe(true);
  });
  it("yapay zeka aciklamasi ve hashtag uyarilari", () => {
    const ai = validateMetadata({
      ...base,
      title: "Rain",
      description: "not medical advice",
      aiGenerated: true,
    });
    expect(ai.some((i) => /Yapay zekâ/.test(i.message))).toBe(true);
    const many = validateMetadata({
      ...base,
      title: "Rain",
      description:
        "not medical advice " + Array.from({ length: 16 }, (_, i) => `#tag${i}`).join(" "),
    });
    expect(many.some((i) => /hashtag/.test(i.message))).toBe(true);
  });
});

describe("yardimcilar", () => {
  it("YouTube kimligi", () => {
    expect(parseYoutubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(parseYoutubeId("https://studio.youtube.com/video/dQw4w9WgXcQ/edit")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeId("merhaba")).toBeNull();
  });
  it("etiketler", () => {
    expect(parseTags("rain, #sleep,\nrain , ,deep sleep")).toEqual(["rain", "sleep", "deep sleep"]);
  });
});
