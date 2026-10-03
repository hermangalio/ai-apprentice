import * as store from "@/lib/store";
import { fail, readJSONBody, SAFE_ID } from "@/lib/capture/http";
import { prewarmVision } from "@/lib/capture/vision";

export async function GET() {
  const all = await store.sessions.list();
  all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return Response.json(all);
}

export async function POST(req: Request) {
  const body = (await readJSONBody(req)) as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return fail(400, "Expected a JSON body");
  const { role, personName, task, workMapSessionId } = body;
  if (role !== "expert" && role !== "learner") return fail(400, 'role must be "expert" or "learner"');
  if (typeof personName !== "string" || !personName.trim()) return fail(400, "personName is required");
  if (typeof task !== "string" || !task.trim()) return fail(400, "task is required");
  if (workMapSessionId !== undefined && (typeof workMapSessionId !== "string" || !SAFE_ID.test(workMapSessionId))) {
    return fail(400, "workMapSessionId is invalid");
  }
  const session = await store.sessions.create({
    role,
    personName: personName.trim(),
    task: task.trim(),
    ...(workMapSessionId ? { workMapSessionId: workMapSessionId as string } : {}),
  });
  // Start the vision process now so the first frame does not pay the cold start.
  prewarmVision(session.id);
  return Response.json(session, { status: 201 });
}
