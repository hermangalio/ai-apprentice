import * as store from "@/lib/store";
import { loadTeachContext } from "@/lib/teach/engine";
import { computeScorecard } from "@/lib/teach/progress";
import { getTeachState, mutateTeachState } from "@/lib/teach/state";

// GET: the scorecard computed from the learner's events, interventions and
// predictions as they stand now. Nothing is written.
// POST: the same, and the result is stored in scorecard.json (end of session).
// Response: { scorecard, items } where `items` has one readable line per
// guardrail and per predicted step.

async function build(id: string, persist: boolean) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return Response.json({ error: "Invalid session id" }, { status: 400 });
  const ctx = await loadTeachContext(id);
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });
  const events = await store.events.all(id);

  if (!persist) {
    const state = await getTeachState(id);
    const { scorecard, items } = computeScorecard(ctx.workMap, events, state.interventions, state.predictions, id);
    return Response.json({ scorecard, items });
  }
  const result = await mutateTeachState(id, (state) => {
    const r = computeScorecard(ctx.workMap, events, state.interventions, state.predictions, id);
    state.mastered = r.scorecard.mastered;
    state.practiceNext = r.scorecard.practiceNext;
    state.interventions = r.interventions;
    return { scorecard: r.scorecard, items: r.items };
  });
  return Response.json(result);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return build((await ctx.params).id, false);
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return build((await ctx.params).id, true);
}
