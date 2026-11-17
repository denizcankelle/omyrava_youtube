import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { type DB, audit, nowIso } from "./db";
import { safeFileName } from "./projects";

export type AssetType = "audio" | "image" | "video_loop" | "thumbnail" | "other";

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  audio: "Ses",
  image: "Görsel",
  video_loop: "Video döngü",
  thumbnail: "Kapak",
  other: "Diğer",
};

const EXT_TYPES: Record<string, AssetType> = {
  ".wav": "audio",
  ".mp3": "audio",
  ".flac": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".ogg": "audio",
  ".opus": "audio",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".mp4": "video_loop",
  ".mov": "video_loop",
  ".webm": "video_loop",
  ".mkv": "video_loop",
};

export const ALLOWED_EXTENSIONS = Object.keys(EXT_TYPES);
export const MAX_ASSET_BYTES = 8 * 1024 ** 3; // 8 GB

export interface Asset {
  id: string;
  project_id: string;
  type: AssetType;
  file_path: string;
  checksum: string | null;
  source: string;
  created_at: string;
  original_name: string | null;
  size_bytes: number | null;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  analysis: string | null;
  analyzed_at: string | null;
  parent_asset_id: string | null;
}

export interface License {
  id: string;
  asset_id: string;
  provider: string;
  license_type: string | null;
  terms_version: string | null;
  evidence_path: string | null;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetError";
  }
}

/** Uzantiya gore tur; "thumbnail" istenirse gorsel olmali. */
export function detectAssetType(fileName: string, requested?: string | null): AssetType {
  const ext = path.extname(fileName).toLowerCase();
  const detected = EXT_TYPES[ext];
  if (!detected) {
    throw new AssetError(
      `Desteklenmeyen dosya türü: ${ext || "(uzantı yok)"}. İzin verilenler: ${ALLOWED_EXTENSIONS.join(", ")}`,
    );
  }
  if (requested === "thumbnail") {
    if (detected !== "image") throw new AssetError("Kapak bir görsel dosyası olmalı");
    return "thumbnail";
  }
  return detected;
}

export function assetDir(dataDir: string, projectId: string): string {
  return path.join(dataDir, "assets", projectId);
}

function storedName(id: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const base = safeFileName(path.basename(originalName, path.extname(originalName)));
  return `${id.slice(0, 8)}-${base}${ext}`;
}

/** Akisi diske yazar; ayni anda sha256 ve boyut hesaplar. Bellege almaz. */
export async function writeStreamWithChecksum(
  input: Readable,
  dest: string,
  maxBytes = MAX_ASSET_BYTES,
): Promise<{ checksum: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) return cb(new AssetError("Dosya çok büyük"));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const tmp = `${dest}.part`;
  try {
    await pipeline(input, meter, fs.createWriteStream(tmp));
    if (size === 0) throw new AssetError("Dosya boş");
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { checksum: hash.digest("hex"), size };
}

function insertAsset(
  db: DB,
  a: {
    id: string;
    projectId: string;
    type: AssetType;
    filePath: string;
    checksum: string;
    size: number;
    originalName: string;
    source: string;
    parentAssetId?: string | null;
  },
): Asset {
  db.prepare(
    `INSERT INTO assets (id, project_id, type, file_path, checksum, size_bytes, original_name, source, parent_asset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id,
    a.projectId,
    a.type,
    a.filePath,
    a.checksum,
    a.size,
    a.originalName,
    a.source,
    a.parentAssetId ?? null,
  );
  audit(db, "asset.add", "asset", a.id, {
    projectId: a.projectId,
    name: a.originalName,
    source: a.source,
  });
  return getAsset(db, a.id)!;
}

/** Tarayicidan gelen ham govdeyi (stream) varlik olarak kaydeder. */
export async function saveUploadedAsset(
  db: DB,
  dataDir: string,
  input: { projectId: string; originalName: string; requestedType?: string | null; body: Readable },
): Promise<Asset> {
  const type = detectAssetType(input.originalName, input.requestedType);
  const id = randomUUID();
  const dir = assetDir(dataDir, input.projectId);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, storedName(id, input.originalName));
  const { checksum, size } = await writeStreamWithChecksum(input.body, dest);
  return insertAsset(db, {
    id,
    projectId: input.projectId,
    type,
    filePath: dest,
    checksum,
    size,
    originalName: path.basename(input.originalName),
    source: "upload",
  });
}

/** Bilgisayardaki bir dosyayi proje klasorune kopyalayarak ekler (buyuk dosyalar icin). */
export async function importAssetFromPath(
  db: DB,
  dataDir: string,
  input: { projectId: string; sourcePath: string; requestedType?: string | null },
): Promise<Asset> {
  const src = input.sourcePath.trim().replace(/^"(.*)"$/, "$1");
  if (!src || !path.isAbsolute(src))
    throw new AssetError("Tam dosya yolu gir (örn. D:\\muzik\\parca.wav)");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(src);
  } catch {
    throw new AssetError(`Dosya bulunamadı: ${src}`);
  }
  if (!stat.isFile()) throw new AssetError("Bu bir dosya değil");
  const type = detectAssetType(src, input.requestedType);
  const id = randomUUID();
  const dir = assetDir(dataDir, input.projectId);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, storedName(id, src));
  const { checksum, size } = await writeStreamWithChecksum(fs.createReadStream(src), dest);
  return insertAsset(db, {
    id,
    projectId: input.projectId,
    type,
    filePath: dest,
    checksum,
    size,
    originalName: path.basename(src),
    source: `import:${src}`,
  });
}

/** Worker'in urettigi dosyayi (or. normalize edilmis ses) varlik olarak kaydeder. */
export async function registerDerivedAsset(
  db: DB,
  input: {
    projectId: string;
    filePath: string;
    type: AssetType;
    parentAssetId: string | null;
    source: string;
    originalName: string;
  },
): Promise<Asset> {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(input.filePath), async function* (src) {
    for await (const chunk of src) hash.update(chunk as Buffer);
  });
  return insertAsset(db, {
    id: randomUUID(),
    projectId: input.projectId,
    type: input.type,
    filePath: input.filePath,
    checksum: hash.digest("hex"),
    size: fs.statSync(input.filePath).size,
    originalName: input.originalName,
    source: input.source,
    parentAssetId: input.parentAssetId,
  });
}

export function getAsset(db: DB, id: string): Asset | undefined {
  return db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Asset | undefined;
}

export function listAssets(db: DB, projectId: string): Asset[] {
  return db
    .prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as unknown as Asset[];
}

/** Varligi ve (yalnizca veri klasoru icindeyse) dosyasini siler. */
export function deleteAsset(db: DB, dataDir: string, id: string): boolean {
  const asset = getAsset(db, id);
  if (!asset) return false;
  const root = path.resolve(dataDir) + path.sep;
  const file = path.resolve(asset.file_path);
  if (file.startsWith(root)) fs.rmSync(file, { force: true });
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  audit(db, "asset.delete", "asset", id, { name: asset.original_name });
  return true;
}

export function updateAssetMeta(
  db: DB,
  id: string,
  meta: {
    durationSec?: number | null;
    width?: number | null;
    height?: number | null;
    analysis?: unknown;
  },
) {
  db.prepare(
    `UPDATE assets SET duration_sec = COALESCE(?, duration_sec), width = COALESCE(?, width),
       height = COALESCE(?, height), analysis = ?, analyzed_at = ? WHERE id = ?`,
  ).run(
    meta.durationSec ?? null,
    meta.width ?? null,
    meta.height ?? null,
    meta.analysis === undefined ? null : JSON.stringify(meta.analysis),
    nowIso(),
    id,
  );
}

// ---------- Lisans ----------

export const licenseSchema = z.object({
  provider: z.string().trim().min(2, "Kaynak/sağlayıcı gerekli").max(200),
  licenseType: z.string().trim().max(200).optional().or(z.literal("")),
  termsVersion: z.string().trim().max(200).optional().or(z.literal("")),
  evidencePath: z.string().trim().max(1000).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  reviewed: z
    .preprocess((v) => v === "on" || v === "true" || v === true, z.boolean())
    .default(false),
});

export type LicenseInput = z.infer<typeof licenseSchema>;

export function upsertLicense(db: DB, assetId: string, input: LicenseInput): License {
  if (!getAsset(db, assetId)) throw new AssetError("Varlık bulunamadı");
  const existing = getLicense(db, assetId);
  const reviewedAt = input.reviewed ? (existing?.reviewed_at ?? nowIso()) : null;
  const values = [
    input.provider,
    input.licenseType || null,
    input.termsVersion || null,
    input.evidencePath || null,
    input.notes || null,
    reviewedAt,
  ];
  if (existing) {
    db.prepare(
      `UPDATE licenses SET provider = ?, license_type = ?, terms_version = ?, evidence_path = ?,
         notes = ?, reviewed_at = ? WHERE asset_id = ?`,
    ).run(...values, assetId);
  } else {
    db.prepare(
      `INSERT INTO licenses (provider, license_type, terms_version, evidence_path, notes, reviewed_at, id, asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...values, randomUUID(), assetId);
  }
  audit(db, "license.save", "asset", assetId, {
    provider: input.provider,
    reviewed: input.reviewed,
  });
  return getLicense(db, assetId)!;
}

export function getLicense(db: DB, assetId: string): License | undefined {
  return db.prepare("SELECT * FROM licenses WHERE asset_id = ?").get(assetId) as
    License | undefined;
}

/** Lisansi onaylanmamis varliklar. Turetilmis varliklar (normalize vb.) ana varligin lisansini kullanir. */
export function assetsMissingLicense(db: DB, projectId: string): Asset[] {
  return db
    .prepare(
      `SELECT a.* FROM assets a
       LEFT JOIN licenses l ON l.asset_id = COALESCE(a.parent_asset_id, a.id)
       WHERE a.project_id = ? AND (l.id IS NULL OR l.reviewed_at IS NULL)
       ORDER BY a.created_at`,
    )
    .all(projectId) as unknown as Asset[];
}

export function formatBytes(n: number | null): string {
  if (n === null) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatClock(sec: number | null): string {
  if (sec === null) return "-";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

export function toNodeReadable(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
}
