import type { ScreenEvent } from "../types";

// Pure helpers that decide when two screen events describe the same thing.
// The sandbox reports every step over the DOM channel and the vision
// model reports it again from the next frame, a few seconds later and in its
// own words. Used when vision events are stored (vision.ts), when questions
// are generated (voice/questions.ts) and when debrief gaps are merged
// (map/build.ts). No imports besides types, so node scripts can load it.

// Two events about the same thing this close together are one event.
export const SAME_EVENT_MS = 6000;
// A DOM event for the entity on screen this recently means the DOM channel
// covers that entity, and vision is not used as the record for it.
export const DOM_AUTHORITY_MS = 15_000;

// An action name in the form the DOM channel uses: lower case, snake_case.
// Taken from the button label or the reported action ("Put on hold" becomes
// "put_on_hold"). Without a name the summary decides, when it names a
// common verb.
export function normalizeAction(action: string | undefined, summary = ""): string | undefined {
  const raw = (action ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (raw) return raw;
  return actionClass(undefined, summary);
}

// Words that carry no meaning when two action descriptions are compared.
const STOP = new Set(
  "a an the to for of on in at by with and or it this that was is be been put set got now application record case item request".split(" "),
);

const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s|e)$/, "") : w);

const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stem);

// Common verbs for what happens to a case, whatever the workflow. Used to see
// that "put_on_hold" and "hold", or "send_to_the_founders" and "escalate",
// name the same thing.
const VERB_CLASSES: Array<[string, RegExp]> = [
  ["reopen", /reopen|re_open|undo/],
  ["hold", /(^|_)hold(_|$)|held|paus|park|defer/],
  ["reject", /reject|declin|den(y|ied)|refus/],
  ["escalate", /escalat|sen[dt]_(it_)?(to|for)|forward|refer(red)?_to|hand(ed)?_(over|off)|rout(e|ed)_to/],
  ["approve", /approv/],
  ["advance", /advanc|proceed|move[d]?_(on|forward|to)|next_(stage|step|round)/],
];

// The class of an action, from its name or else from the summary.
export function actionClass(action: string | undefined, summary = ""): string | undefined {
  const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const name = snake(action ?? "");
  for (const text of [name, name ? "" : snake(summary)]) {
    if (!text) continue;
    for (const [cls, re] of VERB_CLASSES) if (re.test(text)) return cls;
  }
  return name.replace(/^_|_$/g, "") || undefined;
}

type Named = { action?: string; summary: string };

// Loose match between two descriptions of an action on the same entity: the
// same class of verb, or the name of one appears in the name or summary of
// the other ("advance" and "Application C-101 advanced to interview",
// "send_to_founders" and "escalated to the founders").
export function similarAction(a: Named, b: Named): boolean {
  const ca = actionClass(a.action, a.summary);
  const cb = actionClass(b.action, b.summary);
  if (ca && cb && ca === cb) return true;
  const nameA = tokens(a.action ?? "");
  const nameB = tokens(b.action ?? "");
  const allA = new Set([...nameA, ...tokens(a.summary)]);
  const allB = new Set([...nameB, ...tokens(b.summary)]);
  const hit = (name: string[], all: Set<string>) => name.some((w) => [...all].some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x)) && x.length >= 4)));
  if (nameA.length && hit(nameA, allB)) return true;
  if (nameB.length && hit(nameB, allA)) return true;
  // Neither side has a name: the summaries have to share most of their words.
  if (!nameA.length && !nameB.length) {
    const shared = [...allA].filter((w) => allB.has(w)).length;
    return shared >= 2 && shared >= Math.min(allA.size, allB.size) * 0.6;
  }
  return false;
}

const entityKey = (e: Pick<ScreenEvent, "entity">) => (e.entity ? `${e.entity.type.toLowerCase()}:${e.entity.id}` : "");

const kindClass = (e: Pick<ScreenEvent, "kind">) => (e.kind === "open" || e.kind === "navigate" ? "view" : e.kind);

const fieldName = (f: string | undefined) => (f ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// "Fast track" and "fast", or "R-12 Research loop" and "R-12", are the same value.
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
    if (!similarAction(a, b)) return false;
    // The request (confirmation open) and the confirmed action are two different moments.
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
// - Action names are normalised, and rewritten to the name the DOM channel
//   used for a similar action on the same entity earlier in the session.
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
      raw.kind === "action" ? { ...raw, action: domActionName(raw, stored) ?? normalizeAction(raw.action, raw.summary) ?? raw.action } : raw;
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

// The DOM name for a vision action: taken from a DOM action event on the same
// entity that describes the same action, wherever it is in the session.
function domActionName(event: IncomingVisionEvent, stored: ScreenEvent[]): string | undefined {
  const key = entityKey(event);
  if (!key) return undefined;
  return stored.find((e) => e.source === "dom" && e.kind === "action" && e.action && entityKey(e) === key && similarAction(event, e))?.action;
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
  if (e.kind === "action") return `${ent}|action:${actionClass(e.action, e.summary) ?? "?"}`;
  if (e.kind === "field_change") return `${ent}|field:${fieldName(e.field)}`;
  return `${ent}|${kindClass(e)}`;
}
