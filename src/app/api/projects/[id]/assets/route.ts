import { Readable } from "node:stream";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { AssetError, listAssets, saveUploadedAsset, toNodeReadable } from "@/lib/assets";
import { enqueueJob } from "@/lib/jobs";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json(listAssets(getDb(), id));
}

/**
 * Dosya yukleme: govde ham dosya baytlaridir (multipart degil), boylece buyuk dosyalar
 * bellege alinmadan diske akar. Dosya adi `x-file-name` basliginda (URL-encoded) gelir.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  if (!getProject(db, id)) return Response.json({ error: "Proje bulunamadı" }, { status: 404 });
  const rawName = req.headers.get("x-file-name");
  if (!rawName || !req.body) return Response.json({ error: "Dosya gerekli" }, { status: 400 });
  let originalName: string;
  try {
    originalName = decodeURIComponent(rawName);
  } catch {
    return Response.json({ error: "Geçersiz dosya adı" }, { status: 400 });
  }
  try {
    const asset = await saveUploadedAsset(db, getConfig().dataDir, {
      projectId: id,
      originalName,
      requestedType: req.headers.get("x-asset-type"),
      body: toNodeReadable(req.body) as Readable,
    });
    enqueueJob(db, { type: "asset_analyze", projectId: id, payload: { assetId: asset.id } });
    return Response.json(asset, { status: 201 });
  } catch (err) {
    const status = err instanceof AssetError ? 400 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
