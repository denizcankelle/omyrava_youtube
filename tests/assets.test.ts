import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssetError,
  deleteAsset,
  detectAssetType,
  getLicense,
  importAssetFromPath,
  licenseSchema,
  listAssets,
  saveUploadedAsset,
  upsertLicense,
} from "../src/lib/assets";
import {
  ApprovalBlockedError,
  approvalBlockers,
  createProject,
  createProjectSchema,
  setProjectStatus,
} from "../src/lib/projects";
import { memoryDb } from "./helpers";

const tmpDirs: string[] = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "omy-assets-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function setup() {
  const db = memoryDb();
  const project = createProject(
    db,
    createProjectSchema.parse({ title: "Varlik Test", category: "ocean", durationHours: 1 }),
  );
  return { db, project, dataDir: tmp() };
}

describe("varlik turu", () => {
  it("uzantidan tur bulur", () => {
    expect(detectAssetType("a.WAV")).toBe("audio");
    expect(detectAssetType("a.jpg")).toBe("image");
    expect(detectAssetType("a.jpg", "thumbnail")).toBe("thumbnail");
    expect(detectAssetType("a.mp4")).toBe("video_loop");
  });
  it("desteklenmeyenleri reddeder", () => {
    expect(() => detectAssetType("a.exe")).toThrow(AssetError);
    expect(() => detectAssetType("a.wav", "thumbnail")).toThrow(AssetError);
  });
});

describe("yukleme ve ice aktarma", () => {
  it("akistan kaydeder, sha256 ve boyut hesaplar", async () => {
    const { db, project, dataDir } = setup();
    const a = await saveUploadedAsset(db, dataDir, {
      projectId: project.id,
      originalName: "Gece Yağmuru.mp3",
      body: Readable.from([Buffer.from("merhaba")]),
    });
    expect(a.type).toBe("audio");
    expect(a.size_bytes).toBe(7);
    expect(a.checksum).toHaveLength(64);
    expect(fs.readFileSync(a.file_path, "utf8")).toBe("merhaba");
    expect(path.basename(a.file_path)).toMatch(/gece-yagmuru\.mp3$/);
  });
  it("bos dosyayi reddeder ve gecici dosya birakmaz", async () => {
    const { db, project, dataDir } = setup();
    await expect(
      saveUploadedAsset(db, dataDir, {
        projectId: project.id,
        originalName: "x.wav",
        body: Readable.from([]),
      }),
    ).rejects.toThrow(/boş/);
    const dir = path.join(dataDir, "assets", project.id);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(listAssets(db, project.id)).toHaveLength(0);
  });
  it("yoldan ice aktarir, tirnakli yolu kabul eder; goreli yolu reddeder", async () => {
    const { db, project, dataDir } = setup();
    const src = path.join(tmp(), "kapak.png");
    fs.writeFileSync(src, "png");
    const a = await importAssetFromPath(db, dataDir, {
      projectId: project.id,
      sourcePath: `"${src}"`,
      requestedType: "thumbnail",
    });
    expect(a.type).toBe("thumbnail");
    expect(a.source).toBe(`import:${src}`);
    await expect(
      importAssetFromPath(db, dataDir, { projectId: project.id, sourcePath: "kapak.png" }),
    ).rejects.toThrow(AssetError);
    await expect(
      importAssetFromPath(db, dataDir, {
        projectId: project.id,
        sourcePath: path.join(dataDir, "yok.wav"),
      }),
    ).rejects.toThrow(/bulunamadı/);
  });
  it("silme dosyayi da kaldirir", async () => {
    const { db, project, dataDir } = setup();
    const a = await saveUploadedAsset(db, dataDir, {
      projectId: project.id,
      originalName: "a.wav",
      body: Readable.from([Buffer.from("x")]),
    });
    expect(deleteAsset(db, dataDir, a.id)).toBe(true);
    expect(fs.existsSync(a.file_path)).toBe(false);
  });
});

describe("lisans ve yayin onayi", () => {
  it("lisans olmadan onay engellenir, lisansla gecer", async () => {
    const { db, project, dataDir } = setup();
    // ready durumuna getir
    for (const s of ["queued", "generating", "reviewing", "rendering", "ready"] as const)
      setProjectStatus(db, project.id, s);
    expect(approvalBlockers(db, project.id)[0]).toBe("projede ses dosyası yok");

    const audio = await saveUploadedAsset(db, dataDir, {
      projectId: project.id,
      originalName: "muzik.wav",
      body: Readable.from([Buffer.from("x")]),
    });
    expect(() => setProjectStatus(db, project.id, "approved")).toThrow(ApprovalBlockedError);

    upsertLicense(db, audio.id, licenseSchema.parse({ provider: "Kendi üretimim" }));
    expect(approvalBlockers(db, project.id)[0]).toMatch(/lisansı onaylanmamış/);

    upsertLicense(
      db,
      audio.id,
      licenseSchema.parse({ provider: "Kendi üretimim", reviewed: "on" }),
    );
    expect(getLicense(db, audio.id)!.reviewed_at).not.toBeNull();

    // turetilmis varlik ana varligin lisansini kullanir
    db.prepare(
      "INSERT INTO assets (id, project_id, type, file_path, parent_asset_id) VALUES ('d1', ?, 'audio', 'x', ?)",
    ).run(project.id, audio.id);
    // lisans tamam; geriye render, metaveri ve kapak kaldi
    expect(approvalBlockers(db, project.id).join("|")).not.toMatch(/lisans|ses dosyası/);
    expect(approvalBlockers(db, project.id)).toEqual([
      "kalite kontrolünden geçmiş tam render yok",
      "YouTube başlığı/açıklaması girilmemiş",
      "kapak görseli yok",
    ]);
  });
});
