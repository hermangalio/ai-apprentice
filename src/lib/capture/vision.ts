import { createHash } from "crypto";
import { WarmSession, type LLMImage } from "@/lib/llm";
import * as store from "@/lib/store";
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
- Concrete, short, past tense, with the identifiers and values visible on screen: "Invoice 4471 opened (Kessler Werkzeugtechnik, EUR 6,840.00)", "Cost center changed from 4711 to 0400", "Invoice 4472 put on hold", "Purchase order PO-8812 opened next to invoice 4471".
- Never describe layout, colours, window chrome or what the screen looks like.
- kind "open": a record, document or list was opened. "navigate": moved to another view of the same case. "field_change": a field value changed; set field (snake_case, e.g. "cost_center"), before and after. Take "before" from earlier frames or from the known case facts when the old value is no longer visible. "action": something was saved, posted, held, sent, approved or rejected; set action ("save", "hold", "send_for_approval", ...).
- One event per thing that happened. A changed value is always its own "field_change" event with a summary of the form "Cost center changed from 4711 to 0400" (or "Asset number set to A-2291" when there was no value before). Returning to a view that was already open is not an event; report what changed in it.
- committed: true once the change is saved or posted, false when the screen marks it as unsaved or still in edit.
- entity: what the event is about, e.g. {"type": "invoice", "id": "4471"}.
- Ignore clocks, timers, cursor movement, scrolling, hover states, focus rings and text that is still being typed character by character.
- Do not repeat anything listed under "Already recorded".
- If nothing meaningful changed, return "events": [].

facts: what is readable on screen about the case being worked on. Use only these keys and only when visible or already known for this same case: invoice_id (string), supplier (string), supplier_known (boolean), supplier_is_group_company (boolean), amount (number, EUR), category (string such as "equipment", "consumables", "services"), invoice_month (1-12), cost_center (string, keep leading zeros), asset_number (string), status ("open", "posted", "on_hold", "awaiting_approval"). Return {} when no case is visible.

Privacy: company and supplier names, document numbers and amounts are fine. Do not copy personal data into summaries or facts: no names of private individuals, email addresses, phone numbers, postal addresses, bank account or card numbers. Say "bank details changed" instead of quoting them.`;

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
  looseFacts: CaseFacts; // facts read before any invoice id was visible
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

function cleanFacts(raw: unknown): CaseFacts {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: CaseFacts = {};
  for (const k of ["invoice_id", "supplier", "category", "cost_center", "asset_number", "status"] as const) {
    const v = str(r[k], 80);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ["supplier_known", "supplier_is_group_company"] as const) {
    if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  }
  const amount = typeof r.amount === "string" ? Number(r.amount.replace(/,/g, "")) : r.amount;
  if (typeof amount === "number" && Number.isFinite(amount)) out.amount = amount;
  const month = Number(r.invoice_month);
  if (Number.isInteger(month) && month >= 1 && month <= 12) out.invoice_month = month;
  return out;
}

function mergeFacts(st: State, seen: CaseFacts): CaseFacts {
  const id = seen.invoice_id ?? st.currentCase;
  if (!id) {
    st.looseFacts = { ...st.looseFacts, ...seen };
    return st.looseFacts;
  }
  st.currentCase = id;
  st.factsByCase[id] = { ...st.factsByCase[id], ...seen, invoice_id: id };
  return st.factsByCase[id];
}

function cleanEvents(raw: unknown): Array<Omit<ScreenEvent, "id" | "t" | "source">> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Omit<ScreenEvent, "id" | "t" | "source">> = [];
  for (const item of raw.slice(0, MAX_EVENTS_PER_FRAME)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const summary = str(r.summary);
    if (!summary) continue;
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
    if (typeof r.before === "string" || typeof r.before === "number") ev.before = String(r.before).slice(0, 120);
    if (typeof r.after === "string" || typeof r.after === "number") ev.after = String(r.after).slice(0, 120);
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

  const recorded = (await store.events.all(sessionId)).slice(-8).map((e) => `- ${clock(e.t)} ${e.summary}`);
  const known = st.currentCase ? st.factsByCase[st.currentCase] : st.looseFacts;
  const prompt = [
    `Frame at ${clock(t)}. ${imageNote}`,
    `Known case facts: ${JSON.stringify(known)}`,
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
  const facts = mergeFacts(st, cleanFacts(body.facts));
  const events: ScreenEvent[] = cleanEvents(body.events).map((e) => ({
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
