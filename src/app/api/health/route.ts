import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { findFfmpeg } from "@/lib/ffmpeg";
import { readAiStatus } from "@/lib/ai";
import { readImageStatus } from "@/lib/aiimage";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    const q = db
      .prepare(
        "SELECT status, COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') GROUP BY status",
      )
      .all() as { status: string; n: number }[];
    const queue = Object.fromEntries(q.map((r) => [r.status, Number(r.n)]));
    const ffmpeg = findFfmpeg(getConfig().ffmpegPath);
    return Response.json({
      status: ffmpeg ? "ok" : "degraded",
      db: "ok",
      ffmpeg: ffmpeg ?? null,
      node: process.versions.node,
      ai: readAiStatus(getConfig().aiDir),
      imageAi: readImageStatus(getConfig().aiDir),
      queue,
      time: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({ status: "error", message: (err as Error).message }, { status: 500 });
  }
}
