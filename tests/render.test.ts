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

describe("video kodlayici", () => {
  it("nvenc ve x264 argumanlari", async () => {
    const { x264For } = await import("../src/lib/render");
    const nv = x264For(2160, "nvenc");
    expect(nv).toContain("h264_nvenc");
    expect(nv[nv.indexOf("-cq") + 1]).toBe("24");
    expect(nv).toContain("+faststart");
    const x = x264For(1080, "x264");
    expect(x).toContain("libx264");
    expect(x).not.toContain("h264_nvenc");
  });
  it("dosyanin kodlayicisini tanir; nvenc yoksa x264 secilir", async () => {
    const { execFileSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { chooseEncoder, fileEncoder } = await import("../src/lib/encoder");
    const { getVideoEncoder, setVideoEncoder } = await import("../src/lib/render");
    const ff = process.env.FFMPEG_PATH || "ffmpeg";
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "omy-enc-")), "a.mp4");
    execFileSync(ff, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x180:d=1",
      "-c:v",
      "libx264",
      f,
    ]);
    expect(fileEncoder(f)).toBe("x264");
    expect(chooseEncoder(ff, "x264")).toBe("x264");
    expect(getVideoEncoder()).toBe("x264");
    setVideoEncoder("x264");
  });
});

describe("2K", () => {
  it("2K boyutu, profil adi ve bit hizi", async () => {
    const { dims, resName, x264For } = await import("../src/lib/render");
    expect(dims("2k")).toEqual({ w: 2560, h: 1440 });
    expect(resName("2k")).toBe("2k");
    expect(resName(undefined)).toBe("1080p");
    const a = x264For(1440, "x264");
    expect(a[a.indexOf("-maxrate") + 1]).toBe("10M");
  });
  it("yazisiz kapak 2560x1440 ve kalite basamakli", async () => {
    const { cleanCoverArgs } = await import("../src/lib/cover");
    const steps = cleanCoverArgs("a.png", "b.jpg");
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0].join(" ")).toContain("crop=2560:1440");
  });
});
