import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Ornek render isini kuyruga alir. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  if (!getProject(db, id)) return Response.json({ error: "Proje bulunamadi" }, { status: 404 });
  const job = enqueueJob(db, { type: "sample_render", projectId: id, payload: { seconds: 10 } });
  return Response.json(job, { status: 202 });
}
