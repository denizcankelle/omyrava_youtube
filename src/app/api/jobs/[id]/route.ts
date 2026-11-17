import { getDb } from "@/lib/db";
import { getJob, getJobLogs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const job = getJob(db, id);
  if (!job) return Response.json({ error: "Is bulunamadi" }, { status: 404 });
  return Response.json({ ...job, logs: getJobLogs(db, id) });
}
