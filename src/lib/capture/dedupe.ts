import type { ScreenEvent } from "../types";

// Pure helpers that decide when two screen events describe the same thing.
// The sandbox ERP reports every step over the DOM channel and the vision
// model reports it again from the next frame, a few seconds later and in its
// own words. Used when vision events are stored (vision.ts), when questions
// are generated (voice/questions.ts) and when debrief gaps are merged
// (map/build.ts). No imports besides types, so node scripts can load it.

// Two events about the same thing this close together are one event.
export const SAME_EVENT_MS = 6000;
// A DOM event for the entity on screen this recently means the DOM channel
// covers that entity, and vision is not used as the record for it.
export const DOM_AUTHORITY_MS = 15_000;

// Vision action names mapped to the DOM vocabulary (ErpAction in erp/events.ts).
export function normalizeAction(action: string | undefined, summary = ""): string | undefined {
  const raw = (action ?? "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  const text = `${raw} ${summary.toLowerCase()}`;
  if (!raw && !/\b(posted|posting|saved|hold|approval)\b/.test(text)) return undefined;
  if (/approv/.test(raw) || (!raw && /approval/.test(text))) return "send_for_approval";
  if (/hold|held/.test(raw) || (!raw && /\bhold\b/.test(text))) return "hold";
  if (/^(save|saved|post|posted|posting|book|booked|submit|submitted|confirm|confirm_post|confirm_posting)$/.test(raw)) return "save";
  if (!raw && /\b(posted|posting|saved)\b/.test(text)) return "save";
  if (/reopen/.test(raw)) return "reopen";
  return raw || undefined;
}

const entityKey = (e: Pick<ScreenEvent, "entity">) => (e.entity ? `${e.entity.type.toLowerCase()}:${e.entity.id}` : "");

const kindClass = (e: Pick<ScreenEvent, "kind">) => (e.kind === "open" || e.kind === "navigate" ? "view" : e.kind);

const fieldName = (f: string | undefined) => (f ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// "0400 Capex Equipment" and "0400" are the same value.
const sameValue = (a: string | undefined, b: string | undefined) => {
  if (a === undefined || b === undefined) return true;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || x.startsWith(y) || y.startsWith(x);
};

type Comparable = Pick<ScreenEvent, "kind" | "summary" | "entity" | "field" | "after" | "action" | "committed">;

// Same entity and an equivalent kind, action or field. Time is not compared here.
export function sameThing(a: Comparable, b: Comparable): boolean {
  if (entityKey(a) !== entityKey(b)) return false;
  if (kindClass(a) !== kindClass(b)) return false;
  if (a.kind === "field_change") return fieldName(a.field) === fieldName(b.field) && sameValue(a.after, b.after);
  if (a.kind === "action") {
    if (normalizeAction(a.action, a.summary) !== normalizeAction(b.action, b.summary)) return false;
    // "Confirmation open" and "posted" are two different moments.
    return (a.committed ?? true) === (b.committed ?? true);
  }
  if (a.kind === "other") return a.summary === b.summary;
  return true; // open or navigate of the same entity (or of the same list when neither has one)
}

export const isDuplicateEvent = (a: Comparable & { t: number }, b: Comparable & { t: number }, windowMs = SAME_EVENT_MS) =>
  Math.abs(a.t - b.t) <= windowMs && sameThing(a, b);

export type IncomingVisionEvent = Omit<ScreenEvent, "id" | "t" | "source">;

export type VisionDedupeResult = {
  kept: IncomingVisionEvent[];
  dropped: Array<{ event: IncomingVisionEvent; reason: "duplicate" | "dom_covers_entity"; of?: string }>;
};

// Decides which events read from the frame at time `t` are stored.
// - Action names are rewritten to the DOM vocabulary (save, hold, send_for_approval).
// - An event is dropped when a stored event (DOM or vision) for the same
//   entity with an equivalent kind, action or field lies within SAME_EVENT_MS.
// - An event about an entity that has DOM events within DOM_AUTHORITY_MS is
//   dropped as well: for that entity the DOM channel is the record.
// With no DOM events in the session (any other app) only repeats are removed.
export function dedupeVisionEvents(incoming: IncomingVisionEvent[], stored: ScreenEvent[], t: number): VisionDedupeResult {
  const kept: IncomingVisionEvent[] = [];
  const dropped: VisionDedupeResult["dropped"] = [];
  const near = stored.filter((e) => Math.abs(e.t - t) <= DOM_AUTHORITY_MS);
  for (const raw of incoming) {
    const event: IncomingVisionEvent =
      raw.kind === "action" ? { ...raw, action: normalizeAction(raw.action, raw.summary) ?? raw.action } : raw;
    const twin =
      near.find((e) => isDuplicateEvent({ ...event, t }, e)) ??
      (kept.some((k) => sameThing(k, event)) ? ({ id: "same frame" } as ScreenEvent) : undefined);
    if (twin) {
      dropped.push({ event, reason: "duplicate", of: twin.id });
      continue;
    }
    const key = entityKey(event);
    const dom = key ? near.find((e) => e.source === "dom" && entityKey(e) === key) : undefined;
    if (dom) {
      dropped.push({ event, reason: "dom_covers_entity", of: dom.id });
      continue;
    }
    kept.push(event);
  }
  return { kept, dropped };
}

// For event lists that already contain repeats (sessions recorded before the
// de-duplication above): maps every event id to the id of the event that
// stands for it. DOM wins over vision, then the earlier event wins.
export function canonicalEventIds(events: ScreenEvent[]): Map<string, string> {
  const order = [...events].sort((a, b) => (a.source === b.source ? a.t - b.t : a.source === "dom" ? -1 : 1));
  const canon: ScreenEvent[] = [];
  const out = new Map<string, string>();
  for (const e of order) {
    const twin = canon.find((c) => isDuplicateEvent(e, c));
    if (twin) out.set(e.id, twin.id);
    else {
      canon.push(e);
      out.set(e.id, e.id);
    }
  }
  return out;
}

// One key per decision: requesting a hold, confirming it and a vision repeat
// of either all belong to the same action on the same entity.
export function decisionKey(e: ScreenEvent): string {
  const ent = entityKey(e);
  if (!ent) return `event:${e.id}`;
  if (e.kind === "action") return `${ent}|action:${normalizeAction(e.action, e.summary) ?? "?"}`;
  if (e.kind === "field_change") return `${ent}|field:${fieldName(e.field)}`;
  return `${ent}|${kindClass(e)}`;
}
