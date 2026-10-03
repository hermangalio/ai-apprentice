import * as store from "@/lib/store";
import { loadTeachContext } from "@/lib/teach/engine";
import { tutorContext } from "@/lib/teach/instructions";
import { computeProgress } from "@/lib/teach/progress";
import { getTeachState } from "@/lib/teach/state";

// GET ?learnerSessionId=...&full=1
// Everything the tutor panel shows, in one poll: learner events, progress,
// interventions and predictions. With full=1 also the Work Map, the expert's
// events and frames (for the replay) and the tutor context text.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("learnerSessionId") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return Response.json({ error: "learnerSessionId is required" }, { status: 400 });
  const ctx = await loadTeachContext(id);
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });
  const { session, workMap } = ctx;

  const [events, expertEvents, state] = await Promise.all([
    store.events.all(id),
    store.events.all(workMap.sessionId),
    getTeachState(id),
  ]);
  events.sort((a, b) => a.t - b.t);
  const progress = computeProgress(workMap, expertEvents, events, state.interventions, state.predictions);

  const base = { session, events, progress, interventions: state.interventions, predictions: state.predictions };
  if (url.searchParams.get("full") !== "1") return Response.json(base);

  const expertFrames = (await store.frames.all(workMap.sessionId)).sort((a, b) => a.t - b.t);
  return Response.json({ ...base, workMap, expertEvents, expertFrames, context: tutorContext(workMap) });
}
