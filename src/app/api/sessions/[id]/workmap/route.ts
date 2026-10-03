import { buildDraftWorkMap } from "@/lib/map/build";
import { isReadOnly, patchWorkMap, type WorkMapPatch } from "@/lib/map/patch";
import { questions, sessions, transcript, workMaps } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

const fail = (status: number, error: string) => Response.json({ error }, { status });

// In-flight builds, so a double click or a second tab does not start a second model call.
const building = ((globalThis as Record<string, unknown>).__workMapBuilds ??= new Map()) as Map<string, Promise<unknown>>;

// GET: the current Work Map, or 404 {error} if none was built yet.
// With ?with=meta the response is { workMap, meta } where meta tells the page
// which quotes were answers to a question and whether a build is running.
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const map = await workMaps.get(id);
  const wantMeta = new URL(req.url).searchParams.get("with") === "meta";
  if (!wantMeta) return map ? Response.json(map) : fail(404, "No Work Map for this session yet");

  const [session, qs, items] = await Promise.all([sessions.get(id), questions.all(id), transcript.all(id)]);
  if (!session) return fail(404, "Session not found");
  items.sort((a, b) => a.t - b.t);
  const answers = new Set(qs.flatMap((q) => q.answerTranscriptIds ?? []));
  // An expert turn directly after an agent turn is also an answer to a question.
  items.forEach((x, i) => {
    if (x.speaker === "expert" && items[i - 1]?.speaker === "agent") answers.add(x.id);
  });
  return Response.json({
    workMap: map,
    meta: {
      answerTranscriptIds: [...answers],
      building: building.has(id),
      readOnly: await isReadOnly(id),
      debriefTurns: items.filter((x) => x.phase === "debrief").length,
    },
  });
}

// POST: build the draft from the capture session. Replaces an existing map.
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!(await sessions.get(id))) return fail(404, "Session not found");
  if (await isReadOnly(id)) return fail(409, "Fixture sessions are read-only");
  try {
    let run = building.get(id);
    if (!run) {
      run = buildDraftWorkMap(id).finally(() => building.delete(id));
      building.set(id, run);
    }
    return Response.json(await run, { status: 201 });
  } catch (err) {
    return fail(500, (err as Error).message);
  }
}

// PATCH: partial update from the debrief.
// { gap?: {id, status}, gaps?: [{id, status}], teachBack?: {text?, confirmed?, correction?} }
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (await isReadOnly(id)) return fail(409, "Fixture sessions are read-only");
  const body = (await req.json().catch(() => null)) as WorkMapPatch | null;
  if (!body || typeof body !== "object") return fail(400, "Expected a JSON object");
  try {
    return Response.json(await patchWorkMap(id, body));
  } catch (err) {
    const message = (err as Error).message;
    return fail(message.startsWith("No Work Map") ? 404 : 400, message);
  }
}
