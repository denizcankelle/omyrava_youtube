import { getDb } from "@/lib/db";
import { getAsset } from "@/lib/assets";
import { serveFile } from "@/lib/serve";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const asset = getAsset(getDb(), id);
  if (!asset) return new Response("Bulunamadı", { status: 404 });
  return serveFile(req, asset.file_path);
}
