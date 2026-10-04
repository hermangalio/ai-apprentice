import * as store from "@/lib/store";
import type { ScreenEvent, ScreenEventKind } from "@/lib/types";
import { loadTeachContext, runCheck } from "@/lib/teach/engine";

const KINDS: ScreenEventKind[] = ["open", "navigate", "field_change", "action", "other"];

// POST { learnerSessionId, event, persist?, useModel? }
// Checks one learner event against the Work Map's guardrails. Returns the
// violations with the instruction text for the tutor voice agent, and stores
// an Intervention for each new violation.
// `event` is a ScreenEvent. A raw sandbox broadcast event (no id, no t, with
// wallTime) is accepted too. `persist: true` also appends the event to the
// session's event list when it is not there yet (used by the verify script).
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const learnerSessionId = body.learnerSessionId;
  const raw = body.event as (Partial<ScreenEvent> & { wallTime?: number }) | undefined;
  if (typeof learnerSessionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(learnerSessionId)) {
    return Response.json({ error: "learnerSessionId is required" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") return Response.json({ error: "event is required" }, { status: 400 });

  const ctx = await loadTeachContext(learnerSessionId);
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const wall = typeof raw.wallTime === "number" ? raw.wallTime : Date.now();
  const event: ScreenEvent = {
    id: typeof raw.id === "string" && raw.id ? raw.id : `live_${Math.round(wall)}`,
    t: typeof raw.t === "number" ? raw.t : Math.max(0, Math.round(wall - Date.parse(ctx.session.startedAt))),
    kind: KINDS.includes(raw.kind as ScreenEventKind) ? (raw.kind as ScreenEventKind) : "other",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    source: raw.source === "vision" ? "vision" : "dom",
    ...(raw.entity ? { entity: raw.entity } : {}),
    ...(typeof raw.field === "string" ? { field: raw.field } : {}),
    ...(raw.before !== undefined ? { before: String(raw.before) } : {}),
    ...(raw.after !== undefined ? { after: String(raw.after) } : {}),
    ...(typeof raw.action === "string" ? { action: raw.action } : {}),
    ...(typeof raw.committed === "boolean" ? { committed: raw.committed } : {}),
    ...(raw.facts && typeof raw.facts === "object" ? { facts: raw.facts } : {}),
    ...(typeof raw.frameId === "string" ? { frameId: raw.frameId } : {}),
  };

  if (body.persist === true && !learnerSessionId.startsWith("fixture_")) {
    const existing = await store.events.all(learnerSessionId);
    if (!existing.some((e) => e.id === event.id)) await store.events.append(learnerSessionId, event);
  }

  const result = await runCheck(ctx.session, ctx.workMap, event, { useModel: body.useModel !== false });
  return Response.json(result);
}
