import { getDb } from "@/lib/db";
import { createProject, createProjectSchema, listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listProjects(getDb()));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  return Response.json(createProject(getDb(), parsed.data), { status: 201 });
}
