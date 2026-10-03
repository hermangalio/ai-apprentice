import * as store from "@/lib/store";
import type { Prediction } from "@/lib/types";
import { loadTeachContext } from "@/lib/teach/engine";
import { mutateTeachState } from "@/lib/teach/state";

// POST { learnerSessionId, type: "prediction", stepId, prompt, learnerAnswer?, correct? }
// POST { learnerSessionId, type: "outcome", guardrailId, outcome: "corrected" | "overridden" }
// Called by the tutor's client tools and by the panel's text fallback.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const id = body.learnerSessionId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return Response.json({ error: "learnerSessionId is required" }, { status: 400 });
  }
  const ctx = await loadTeachContext(id);
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });
  const t = Math.max(0, Date.now() - Date.parse(ctx.session.startedAt));

  if (body.type === "prediction") {
    const stepId = String(body.stepId ?? "");
    if (!ctx.workMap.steps.some((s) => s.id === stepId)) {
      return Response.json({ error: `Unknown step ${stepId}` }, { status: 400 });
    }
    const correct = typeof body.correct === "boolean" ? body.correct : body.correct === "true" ? true : body.correct === "false" ? false : undefined;
    const prediction: Prediction = {
      id: store.newId("prd"),
      t,
      stepId,
      prompt: String(body.prompt ?? ""),
      ...(body.learnerAnswer !== undefined ? { learnerAnswer: String(body.learnerAnswer) } : {}),
      ...(correct !== undefined ? { correct } : {}),
    };
    await mutateTeachState(id, (state) => {
      state.predictions.push(prediction);
    });
    return Response.json(prediction, { status: 201 });
  }

  if (body.type === "outcome") {
    const guardrailId = String(body.guardrailId ?? "");
    const outcome = body.outcome === "overridden" ? "overridden" : body.outcome === "corrected" ? "corrected" : null;
    if (!outcome) return Response.json({ error: 'outcome must be "corrected" or "overridden"' }, { status: 400 });
    const updated = await mutateTeachState(id, (state) => {
      // The latest intervention for this guardrail that has no outcome yet.
      const open = [...state.interventions].reverse().find((i) => i.guardrailId === guardrailId && !i.outcome);
      if (open) open.outcome = outcome;
      return open ?? null;
    });
    if (!updated) return Response.json({ error: `No open intervention for ${guardrailId}` }, { status: 404 });
    return Response.json(updated);
  }

  return Response.json({ error: 'type must be "prediction" or "outcome"' }, { status: 400 });
}
