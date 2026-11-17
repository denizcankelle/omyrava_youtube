import { describe, expect, it } from "vitest";
import {
  audioLoopArgs,
  estimateOutputBytes,
  evaluateFinal,
  evaluateLoopQa,
  fullAudioArgs,
  muxArgs,
  parseLoopQa,
  renderOptionsSchema,
  videoLoopFromVideoArgs,
} from "../src/lib/render";

describe("render plani", () => {
  it("secenekleri dogrular", () => {
    const o = renderOptionsSchema.parse({
      projectId: "p",
      audioAssetId: "a",
      visualAssetId: "v",
      mode: "full",
      seamless: "on",
    });
    expect(o.seamless).toBe(true);
    expect(o.motion).toBe("drift");
    expect(
      renderOptionsSchema.safeParse({
        projectId: "p",
        audioAssetId: "",
        visualAssetId: "v",
        mode: "full",
      }).success,
    ).toBe(false);
  });

  it("kusursuz video dongusu capraz gecis icerir; dongu suresi L-d olur", () => {
    const args = videoLoopFromVideoArgs("in.mp4", "out.mp4", 8, true).join(" ");
    expect(args).toContain("xfade=transition=fade:duration=1.000:offset=0");
    expect(args).toContain("trim=start=7.000:end=8.000");
    expect(args).toContain("-bf 0");
    expect(videoLoopFromVideoArgs("in.mp4", "out.mp4", 8, false).join(" ")).not.toContain("xfade");
  });

  it("ses dongusu kisa seste capraz gecisi kisaltir", () => {
    expect(audioLoopArgs("a", "b", 12).join(" ")).toContain("afade=t=out:d=3.000");
    expect(audioLoopArgs("a", "b", 600).join(" ")).toContain("afade=t=out:d=20.000");
  });

  it("tam ses ve birlestirme komutlari", () => {
    const a = fullAudioArgs("l.flac", "o.m4a", 36000, true).join(" ");
    expect(a).toContain("-stream_loop -1");
    expect(a).toContain("afade=t=out:st=35990.000:d=10.000");
    expect(fullAudioArgs("l.flac", "o.m4a", 36000, false).join(" ")).not.toContain("stream_loop");
    const m = muxArgs("v.mp4", "a.m4a", "o.mp4", 3600).join(" ");
    expect(m).toContain("-stream_loop -1 -i v.mp4");
    expect(m).toContain("-c copy -t 3600.000");
  });

  it("dongu QA ciktisini ayristirir", () => {
    const out = `[blackdetect @ 0x] black_start:2 black_end:3.5 black_duration:1.5
[Parsed_metadata_2 @ 0x] frame:0    pts:25600   pts_time:2
[Parsed_metadata_2 @ 0x] lavfi.black_start=2
[Parsed_metadata_2 @ 0x] lavfi.scene_score=1.000000`;
    const qa = parseLoopQa(out);
    expect(qa.blackSec).toBeCloseTo(1.5);
    expect(qa.sceneCuts).toEqual([2]);
    const issues = evaluateLoopQa(qa, 60);
    expect(issues.map((i) => i.level)).toEqual(["warn", "warn"]);
    expect(evaluateLoopQa({ blackSec: 40, blackRanges: [], sceneCuts: [] }, 60)[0].level).toBe(
      "error",
    );
  });

  it("son kontrol: sure ve akislar", () => {
    const info =
      "Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps\nStream #0:1: Audio: aac (LC), 48000 Hz";
    expect(evaluateFinal(info, 3600, 3600.02)).toEqual([]);
    expect(evaluateFinal(info, 3600, 3500)[0].message).toMatch(/Süre/);
    expect(evaluateFinal("Video: h264 1280x720", 10, 10).length).toBe(2);
  });

  it("boyut tahmini", () => {
    // 60 sn'lik 15 MB dongu (2 Mbps) + 192 kbps ses, 10 saat
    const est = estimateOutputBytes(15_000_000, 60, 36000);
    expect(est / 1024 ** 3).toBeGreaterThan(8);
    expect(est / 1024 ** 3).toBeLessThan(11);
  });
});
