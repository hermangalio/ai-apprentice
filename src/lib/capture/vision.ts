import { createHash } from "crypto";
import { WarmSession, type LLMImage } from "@/lib/llm";
import * as store from "@/lib/store";
import { dedupeVisionEvents } from "./dedupe";
import { redact } from "./redact";
import type { CaseFacts, Frame, ScreenEvent, ScreenEventKind } from "@/lib/types";

// Server-only. Turns uploaded frames into ScreenEvents with one warm vision
// session per capture session.

const SYSTEM = `You watch a screen recording of an expert doing a work task, one frame at a time, and report what the person DID since the previous frame.

Reply with one JSON object:
{"events": [ ... ], "facts": { ... }}

events: zero to three items, oldest first. Each item:
{"kind": "open" | "navigate" | "field_change" | "action" | "other",
 "summary": string,
 "entity": {"type": string, "id": string},
 "field": string, "before": string, "after": string,
 "action": string,
 "committed": boolean}
Only "kind" and "summary" are required. Leave out keys you cannot fill.

Rules for events:
- Concrete, short, past tense, with the identifiers and values visible on screen, in the words the screen uses: "Record R-2041 opened (Harbour Clinic, renewal)", "Priority changed from Normal to Urgent", "Reviewer set to Kim", "Request R-2042 put on hold", "History of R-2041 opened".
- Never describe layout, colours, window chrome or what the screen looks like.
- kind "open": a record, document or list was opened. "navigate": moved to another view of the same case. "field_change": a field value changed; set field (the field's label in snake_case), before and after. Take "before" from earlier frames or from the known case facts when the old value is no longer visible. "action": a button was used that does something to the case (it was saved, submitted, advanced, held, sent to someone, approved, rejected, ...); set action to the button label in lower snake_case ("Put on hold" is "put_on_hold"). If the same action was reported earlier in this session under a name listed in "Action names used so far", use that name.
- One event per thing that happened. A changed value is always its own "field_change" event with a summary of the form "<Field> changed from <old> to <new>" (or "<Field> set to <new>" when there was no value before). Returning to a view that was already open is not an event; report what changed in it.
- committed: true once the change or action is saved or confirmed, false when the screen marks it as unsaved, still in edit, or shows a confirmation box that has not been answered.
- entity: what the event is about, with the kind of record and its id as shown, e.g. {"type": "request", "id": "R-2041"}. Use the entity type from "Already recorded" when there is one.
- Ignore clocks, timers, cursor movement, scrolling, hover states, focus rings and text that is still being typed character by character.
- Do not repeat anything listed under "Already recorded".
- If nothing meaningful changed, return "events": [].

facts: what is readable on screen about the case being worked on, as one flat JSON object. Keys in snake_case, values a string, a number or true/false; no nested objects or lists. Include the id of the case, the fields that a decision could depend on (names of categories, amounts as plain numbers, yes/no flags, the current value of each editable field, the status), and nothing that is not on screen or already known for this same case. When "Fact keys used so far" lists keys, use exactly those key names for the same things and the same value style as in "Known case facts"; add a new key only for something they do not cover. Return {} when no case is visible.

Privacy: the name of the organisation or person a case is about, document numbers and amounts are fine. Do not copy contact or payment details into summaries or facts: no email addresses, phone numbers, postal addresses, dates of birth, bank account or card numbers. Say "bank details changed" instead of quoting them.`;

// A vision process is used for at most ROTATE_AFTER calls, then replaced so
// its context (one image per call) stays bounded. The replacement is started
// PREWARM_LEAD calls earlier, so no frame waits for a cold process.
const ROTATE_AFTER = 30;
const PREWARM_LEAD = 5;
const MAX_EVENTS_PER_FRAME = 3;

type State = {
  active: WarmSession;
  activeCalls: number; // calls made on `active`, including the warm-up ping
  next: WarmSession | null;
  needsBaseline: boolean; // `active` has not seen the previous frame yet
  lastImage: LLMImage | null;
  lastHash: string | null;
  factsByCase: Record<string, CaseFacts>;
  currentCase: string | null;
  looseFacts: CaseFacts; // facts read before any case id was visible
  chain: Promise<unknown>; // frames of one session are processed in order
};

const states = ((globalThis as Record<string, unknown>).__captureVision ??= new Map()) as Map<string, State>;
// Off-the-record windows per session, kept apart from State so they also
// apply to sessions that have no vision process (yet).
const purgedWindows = ((globalThis as Record<string, unknown>).__capturePurged ??= new Map()) as Map<
  string,
  Array<[number, number]>
>;

function spawn(): WarmSession {
  // maxCalls equals ROTATE_AFTER: the process exits by itself after its last call.
  const s = new WarmSession({ system: SYSTEM, model: "haiku", maxCalls: ROTATE_AFTER });
  s.ask('Warm-up. No frame yet. Reply with {"events": [], "facts": {}}').catch((err) => {
    console.error("[capture] vision warm-up failed:", err);
  });
  return s;
}

function getState(sessionId: string): State {
  let st = states.get(sessionId);
  if (!st) {
    st = {
      active: spawn(),
      activeCalls: 1,
      next: null,
      needsBaseline: false,
      lastImage: null,
      lastHash: null,
      factsByCase: {},
      currentCase: null,
      looseFacts: {},
      chain: Promise.resolve(),
    };
    states.set(sessionId, st);
  }
  return st;
}

// Start the vision process for a session so the first frame is not cold.
export function prewarmVision(sessionId: string) {
  getState(sessionId);
}

// Forget the session and end its model processes.
export function releaseVision(sessionId: string) {
  const st = states.get(sessionId);
  st?.active.close();
  st?.next?.close();
  states.delete(sessionId);
}

// Off the record: remember the window so late results are dropped, and move
// to a fresh model process so purged frames are no longer in its context.
export function purgeVision(sessionId: string, fromT: number, toT: number) {
  purgedWindows.set(sessionId, [...(purgedWindows.get(sessionId) ?? []), [fromT, toT]]);
  const st = states.get(sessionId);
  if (!st) return;
  st.active.close();
  st.next?.close();
  st.active = spawn();
  st.activeCalls = 1;
  st.next = null;
  st.needsBaseline = false;
  st.lastImage = null;
  st.lastHash = null;
  // Facts may have been read inside the window; they are read again from the next frame.
  st.factsByCase = {};
  st.currentCase = null;
  st.looseFacts = {};
}

export function isPurged(sessionId: string, t: number) {
  return purgedWindows.get(sessionId)?.some(([a, b]) => t >= a && t <= b) ?? false;
}

function pickSession(st: State): WarmSession {
  if (st.activeCalls >= ROTATE_AFTER) {
    st.active = st.next ?? spawn();
    st.next = null;
    st.activeCalls = 1;
    st.needsBaseline = true;
  } else if (!st.next && st.activeCalls >= ROTATE_AFTER - PREWARM_LEAD) {
    st.next = spawn();
  }
  st.activeCalls++;
  return st.active;
}

const KINDS: ScreenEventKind[] = ["open", "navigate", "field_change", "action", "other"];
const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : undefined;

const MAX_FACTS = 30;

// Any flat record: snake_case keys, string, number or boolean values.
function cleanFacts(raw: unknown): CaseFacts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CaseFacts = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_FACTS)) {
    const k = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
    if (!k || /^\d/.test(k)) continue;
    if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") {
      const text = v.trim();
      // "true", "yes", "6,840.00": the DOM channel sends these as booleans and numbers.
      if (/^(true|yes)$/i.test(text)) out[k] = true;
      else if (/^(false|no)$/i.test(text)) out[k] = false;
      else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) out[k] = Number(text.replace(/,/g, ""));
      else out[k] = redact(text.slice(0, 80));
    }
  }
  return out;
}

// The fact that identifies the case: "candidate_id", "order_id", "id", ...
// Keys the DOM channel already used in this session come first.
function caseIdOf(facts: CaseFacts, knownKeys: string[], entityType?: string): string | undefined {
  const isId = (k: string) => /(^|_)(id|number|no)$/.test(k);
  const order = [
    ...(entityType ? [`${entityType.toLowerCase()}_id`] : []),
    ...knownKeys.filter(isId),
    ...Object.keys(facts).filter(isId),
  ];
  for (const k of order) {
    const v = facts[k];
    if ((typeof v === "string" && v) || typeof v === "number") return String(v);
  }
  return undefined;
}

function mergeFacts(st: State, seen: CaseFacts, knownKeys: string[], entity?: { type: string; id: string }): CaseFacts {
  const id = caseIdOf(seen, knownKeys, entity?.type) ?? entity?.id ?? st.currentCase;
  if (!id) {
    st.looseFacts = { ...st.looseFacts, ...seen };
    return st.looseFacts;
  }
  // Facts read before the id was visible belong to the first case.
  const carried = st.currentCase === null ? st.looseFacts : {};
  st.looseFacts = {};
  st.currentCase = id;
  st.factsByCase[id] = { ...carried, ...st.factsByCase[id], ...seen };
  return st.factsByCase[id];
}

function cleanEvents(raw: unknown): Array<Omit<ScreenEvent, "id" | "t" | "source">> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Omit<ScreenEvent, "id" | "t" | "source">> = [];
  for (const item of raw.slice(0, MAX_EVENTS_PER_FRAME)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    // The prompt asks the model to leave personal data out; this masks what
    // it copies anyway.
    const rawSummary = str(r.summary);
    if (!rawSummary) continue;
    const summary = redact(rawSummary);
    let kind = KINDS.includes(r.kind as ScreenEventKind) ? (r.kind as ScreenEventKind) : "other";
    // A named field with a new value is a field change, whatever the model called it.
    if (kind !== "action" && str(r.field, 60) && (typeof r.after === "string" || typeof r.after === "number")) {
      kind = "field_change";
    }
    const ev: Omit<ScreenEvent, "id" | "t" | "source"> = { kind, summary };
    const ent = r.entity as Record<string, unknown> | undefined;
    const entType = ent && str(ent.type, 40);
    const entId = ent && str(ent.id, 40);
    if (entType && entId) ev.entity = { type: entType, id: entId };
    const field = str(r.field, 60);
    if (field) ev.field = field;
    if (typeof r.before === "string" || typeof r.before === "number") ev.before = redact(String(r.before)).slice(0, 120);
    if (typeof r.after === "string" || typeof r.after === "number") ev.after = redact(String(r.after)).slice(0, 120);
    const action = str(r.action, 40);
    if (action) ev.action = action;
    if (typeof r.committed === "boolean") ev.committed = r.committed;
    out.push(ev);
  }
  return out;
}

const clock = (t: number) => {
  const s = Math.max(0, Math.round(t / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// A DOM event arrives before the frame that shows its result has been
// captured. A frame taken up to this long after the event is taken as that
// result.
const RELINK_MS = 5000;

// The frame a DOM event at time t is shown with: the first frame taken at or
// shortly after t, otherwise the nearest one.
export function frameForDomEvent(frames: Frame[], t: number): string | undefined {
  let after: Frame | undefined;
  let nearest: Frame | undefined;
  for (const f of frames) {
    if (f.t >= t && f.t - t <= RELINK_MS && (!after || f.t < after.t)) after = f;
    if (!nearest || Math.abs(f.t - t) < Math.abs(nearest.t - t)) nearest = f;
  }
  return (after ?? nearest)?.id;
}

// A new frame was stored: DOM events from the few seconds before it that
// still point at an older frame (or at none) are linked to the new one, so
// the Work Map shows the screen after the action.
async function relinkDomEvents(sessionId: string, frame: Frame) {
  const frameT = new Map((await store.frames.all(sessionId)).map((f) => [f.id, f.t]));
  await store.events.update(sessionId, (all) =>
    all.map((e) => {
      if (e.source !== "dom" || e.t > frame.t || frame.t - e.t > RELINK_MS) return e;
      const linkedT = e.frameId ? frameT.get(e.frameId) : undefined;
      // Keep a link to a frame that already shows the result.
      if (linkedT !== undefined && linkedT >= e.t) return e;
      return { ...e, frameId: frame.id };
    }),
  );
}

export type FrameResult = { frame: Frame | null; events: ScreenEvent[]; modelMs: number; skipped?: string };

// Save one frame and return the events the vision model reads from it.
export function processFrame(sessionId: string, jpeg: Buffer, t: number): Promise<FrameResult> {
  const st = getState(sessionId);
  const run = st.chain.then(() => processFrameNow(sessionId, st, jpeg, t));
  st.chain = run.catch(() => {});
  return run;
}

async function processFrameNow(sessionId: string, st: State, jpeg: Buffer, t: number): Promise<FrameResult> {
  if (isPurged(sessionId, t)) return { frame: null, events: [], modelMs: 0, skipped: "off_record" };

  // Identical bytes as the previous frame: nothing to ask the model.
  const hash = createHash("sha1").update(jpeg).digest("hex");
  if (hash === st.lastHash) return { frame: null, events: [], modelMs: 0, skipped: "identical" };

  const frame: Frame = { id: store.newId("frm"), t, file: "" };
  frame.file = await store.saveFrameImage(sessionId, frame.id, jpeg);
  await store.frames.append(sessionId, frame);
  await relinkDomEvents(sessionId, frame);

  const image: LLMImage = { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
  const session = pickSession(st);
  const images = st.needsBaseline && st.lastImage ? [st.lastImage, image] : [image];
  const imageNote =
    images.length === 2
      ? "Two images: the first is the previous frame (already processed), the second is the new frame."
      : st.lastHash
        ? "The image is the new frame. Compare it with the previous frame you saw."
        : "The image is the first frame of the session. Report what is open on screen.";
  st.needsBaseline = false;
  st.lastImage = image;
  st.lastHash = hash;

  const stored = await store.events.all(sessionId);
  const recorded = stored.slice(-8).map((e) => `- ${clock(e.t)} ${e.summary}${e.entity ? ` [${e.entity.type} ${e.entity.id}]` : ""}`);
  // The vocabulary of this session so far, so the model keeps to it. The DOM
  // channel's names come first.
  const domFirst = [...stored].sort((a, b) => Number(b.source === "dom") - Number(a.source === "dom"));
  const knownKeys = [...new Set(domFirst.flatMap((e) => Object.keys(e.facts ?? {})))].slice(0, MAX_FACTS);
  const knownActions = [...new Set(domFirst.map((e) => e.action).filter((a): a is string => !!a))].slice(0, 12);
  // Where the DOM channel reports on the case on screen, its facts are the known ones.
  const domFacts = [...stored].reverse().find((e) => e.source === "dom" && e.facts && t - e.t <= 60_000)?.facts;
  const known = domFacts ?? (st.currentCase ? st.factsByCase[st.currentCase] : st.looseFacts);
  const prompt = [
    `Frame at ${clock(t)}. ${imageNote}`,
    `Known case facts: ${JSON.stringify(known)}`,
    `Fact keys used so far: ${knownKeys.length ? knownKeys.join(", ") : "none yet"}`,
    `Action names used so far: ${knownActions.length ? knownActions.join(", ") : "none yet"}`,
    `Already recorded:\n${recorded.length ? recorded.join("\n") : "- nothing yet"}`,
    "What did the person do since the previous frame?",
  ].join("\n\n");

  const started = Date.now();
  let parsed: { events?: unknown; facts?: unknown } | unknown[];
  try {
    parsed = await session.askJSON<{ events?: unknown; facts?: unknown } | unknown[]>(prompt, images);
  } catch (err) {
    console.error("[capture] vision call failed:", err);
    return { frame, events: [], modelMs: Date.now() - started, skipped: "model_error" };
  }
  const modelMs = Date.now() - started;

  // The window may have been purged while the model was working.
  if (isPurged(sessionId, t)) return { frame: null, events: [], modelMs, skipped: "off_record" };

  const body = Array.isArray(parsed) ? { events: parsed, facts: {} } : (parsed ?? {});
  const cleaned = cleanEvents(body.events);
  const facts = mergeFacts(st, cleanFacts(body.facts), knownKeys, cleaned.find((e) => e.entity)?.entity);
  // The prompt asks the model not to repeat recorded events; it does anyway.
  // Repeats of stored events are removed here, and where the DOM channel
  // reports on the entity on screen, the DOM events stay the record.
  const { kept, dropped } = dedupeVisionEvents(cleaned, await store.events.all(sessionId), t);
  if (dropped.length) {
    console.log(`[capture] ${dropped.length} vision event(s) not stored at ${clock(t)}: ${dropped.map((d) => `${d.event.summary} (${d.reason})`).join("; ")}`);
  }
  const events: ScreenEvent[] = kept.map((e) => ({
    ...e,
    id: store.newId("evt"),
    t,
    frameId: frame.id,
    source: "vision",
    ...(Object.keys(facts).length ? { facts: { ...facts } } : {}),
  }));
  if (events.length) await store.events.append(sessionId, ...events);
  return { frame, events, modelMs };
}
