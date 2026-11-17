import { getDb } from "@/lib/db";
import { serveFile } from "@/lib/serve";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getDb()
    .prepare("SELECT output_path FROM renders WHERE id = ? AND status = 'done'")
    .get(id) as { output_path: string } | undefined;
  if (!row) return new Response("Bulunamadı", { status: 404 });
  return serveFile(req, row.output_path);
}
