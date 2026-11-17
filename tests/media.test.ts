import { describe, expect, it } from "vitest";
import {
  buildNormalizeFilter,
  evaluateAudio,
  evaluateVisual,
  parseLoudnorm,
  parseSilences,
  parseVideoSize,
  parseVolumeDetect,
} from "../src/lib/media";

const LOUDNORM = `[Parsed_loudnorm_2 @ 0x1]
{
	"input_i" : "-23.40",
	"input_tp" : "-0.50",
	"input_lra" : "17.20",
	"input_thresh" : "-33.90",
	"output_i" : "-18.10",
	"output_tp" : "-2.00",
	"output_lra" : "9.00",
	"output_thresh" : "-28.50",
	"normalization_type" : "dynamic",
	"target_offset" : "0.10"
}`;

describe("FFmpeg cikti ayristirma", () => {
  it("loudnorm JSON", () => {
    const s = parseLoudnorm("onceki satirlar\n" + LOUDNORM)!;
    expect(s.input_i).toBe(-23.4);
    expect(s.input_tp).toBe(-0.5);
    expect(s.target_offset).toBe(0.1);
  });
  it("sessiz dosyada loudnorm -inf -> null", () => {
    expect(parseLoudnorm(LOUDNORM.replace('"-23.40"', '"-inf"'))).toBeNull();
    expect(parseLoudnorm("yok")).toBeNull();
  });
  it("sessizlik bolumleri (sonda acik kalan dahil)", () => {
    const err = `[silencedetect @ 0x] silence_start: 12.5
[silencedetect @ 0x] silence_end: 25.0 | silence_duration: 12.5
[silencedetect @ 0x] silence_start: 95`;
    expect(parseSilences(err, 100)).toEqual([
      { start: 12.5, end: 25, duration: 12.5 },
      { start: 95, end: 100, duration: 5 },
    ]);
  });
  it("volumedetect", () => {
    const v = parseVolumeDetect("mean_volume: -24.1 dB\nmax_volume: 0.0 dB\nhistogram_0db: 42");
    expect(v).toEqual({ mean: -24.1, max: 0, clipped: 42 });
  });
  it("goruntu boyutu", () => {
    expect(parseVideoSize("  Stream #0:0: Video: png, rgb24(pc), 1920x1080, 25 tbr")).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(
      parseVideoSize(
        "Stream #0:0[0x1](und): Video: h264 (High), yuv420p(tv, bt709, progressive), 3840x2160 [SAR 1:1 DAR 16:9], 30 fps",
      ),
    ).toEqual({ width: 3840, height: 2160 });
    expect(parseVideoSize("Stream #0:0: Audio: aac")).toBeNull();
  });
});

describe("kalite kurallari", () => {
  it("ses: yuksek tepe, dalgalanma, clipping ve uzun sessizlik uyarilari", () => {
    const w = evaluateAudio({
      durationSec: 3600,
      loudness: parseLoudnorm(LOUDNORM),
      meanVolumeDb: -24,
      maxVolumeDb: 0,
      clippedSamples: 42,
      silences: [{ start: 100, end: 130, duration: 30 }],
    });
    const text = w.map((x) => x.message).join("|");
    expect(text).toMatch(/Tepe/);
    expect(text).toMatch(/dalgalı/);
    expect(text).toMatch(/Clipping/);
    expect(text).toMatch(/Uzun sessizlik/);
  });
  it("ses: temiz dosyada uyari yok", () => {
    expect(
      evaluateAudio({
        durationSec: 3600,
        loudness: { input_i: -18, input_tp: -3, input_lra: 6, input_thresh: -28, target_offset: 0 },
        meanVolumeDb: -20,
        maxVolumeDb: -3,
        clippedSamples: 0,
        silences: [{ start: 3595, end: 3600, duration: 5 }],
      }),
    ).toEqual([]);
  });
  it("gorsel: oran, cozunurluk, kapak boyutu", () => {
    expect(
      evaluateVisual("image", { width: 1920, height: 1080, durationSec: null, sizeBytes: 1 }),
    ).toEqual([]);
    expect(
      evaluateVisual("image", { width: 1080, height: 1080, durationSec: null, sizeBytes: 1 })
        .length,
    ).toBe(2);
    const t = evaluateVisual("thumbnail", {
      width: 1280,
      height: 720,
      durationSec: null,
      sizeBytes: 3e6,
    });
    expect(t[0].level).toBe("error");
  });
  it("normalize filtresi olculen degerleri ve fade'i icerir", () => {
    const f = buildNormalizeFilter(parseLoudnorm(LOUDNORM)!, 3600);
    expect(f).toContain("measured_I=-23.4");
    expect(f).toContain("linear=true");
    expect(f).toContain("afade=t=in:st=0:d=5.00");
    expect(f).toContain("afade=t=out:st=3590.00:d=10.00");
    // kisa seste fade sureye gore kisalir
    expect(buildNormalizeFilter(parseLoudnorm(LOUDNORM)!, 20)).toContain("d=2.00");
  });
});
