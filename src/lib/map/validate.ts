import type { Frame, GuardrailCheck, Quote, ScreenEvent, ScreenMoment, TranscriptItem } from "../types";
import { fmtT } from "./debrief";

// Hard checks applied to everything the model returns. Nothing here trusts
// the prompt: quotes must be verbatim, ids must exist.

export type RawQuote = { transcriptId?: string; text?: string } | null | undefined;

// Lowercased, whitespace-collapsed copy of `s`, with a map from each output
// character back to its index in `s`.
function normalize(s: string) {
  const out: string[] = [];
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (/\s/.test(c)) {
      if (!prevSpace) {
        out.push(" ");
        map.push(i);
        prevSpace = true;
      }
      continue;
    }
    if (c === "‘" || c === "’") c = "'";
    else if (c === "“" || c === "”") c = '"';
    else if (c === "–" || c === "—") c = "-";
    const lower = c.toLowerCase();
    out.push(lower.length === 1 ? lower : c);
    map.push(i);
    prevSpace = false;
  }
  return { text: out.join(""), map };
}

// Returns the exact slice of `haystack` that matches `needle`, or null.
export function locateVerbatim(haystack: string, needle: string): string | null {
  const wanted = needle.trim();
  if (!wanted) return null;
  if (haystack.includes(wanted)) return wanted;
  const h = normalize(haystack);
  const candidates = [
    normalize(wanted).text.trim(),
    // Models often add or drop surrounding quotes, ellipses and final punctuation.
    normalize(wanted.replace(/^["'\s.…]+|["'\s.…]+$/g, "")).text.trim(),
  ];
  for (const n of candidates) {
    if (n.length < 4) continue;
    const at = h.text.indexOf(n);
    if (at >= 0) return haystack.slice(h.map[at], h.map[at + n.length - 1] + 1);
  }
  return null;
}

// Resolves a model-supplied quote to a verbatim one. Order: the cited item,
// then any other item by the expert. Returns null when the words cannot be
// found, so the caller drops the quote.
export function resolveQuote(raw: RawQuote, transcript: TranscriptItem[]): Quote | null {
  if (!raw) return null;
  const expert = transcript.filter((x) => x.speaker === "expert");
  const cited = expert.find((x) => x.id === raw.transcriptId);
  const text = (raw.text ?? "").trim();
  const make = (item: TranscriptItem, exact: string): Quote => ({
    text: exact,
    transcriptId: item.id,
    t: item.t,
    source: item.phase === "debrief" ? "debrief" : "live",
  });
  if (cited) {
    if (!text) return make(cited, cited.text);
    const hit = locateVerbatim(cited.text, text);
    if (hit) return make(cited, hit);
  }
  if (!text) return null;
  for (const item of expert) {
    const hit = locateVerbatim(item.text, text);
    if (hit) return make(item, hit);
  }
  return null;
}

export function isVerbatim(q: Quote, transcript: TranscriptItem[]) {
  const item = transcript.find((x) => x.id === q.transcriptId);
  return !!item && item.text.includes(q.text);
}

function nearestFrame(frames: Frame[], t: number) {
  let best: Frame | null = null;
  for (const f of frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}

// Picks a real frame for a step or guardrail. Preference: the event the model
// named, a frame it named, the last event of the step that has a frame, then
// the frame nearest in time. Returns null only if the session has no frames.
export function resolveMoment(
  raw: { momentEventId?: string; frameId?: string; momentLabel?: string; eventIds?: string[] },
  events: ScreenEvent[],
  frames: Frame[],
): ScreenMoment | null {
  const frameById = new Map(frames.map((f) => [f.id, f]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const label = (t: number, fallback: string) => {
    const text = (raw.momentLabel ?? "").replace(/^\s*\d{1,2}:\d{2}\s*[,:-]?\s*/, "").trim() || fallback;
    return `${fmtT(t)}, ${text}`;
  };
  const fromEvent = (e: ScreenEvent | undefined): ScreenMoment | null => {
    if (!e) return null;
    const frame = (e.frameId && frameById.get(e.frameId)) || null;
    if (frame) return { t: e.t, frameId: frame.id, label: label(e.t, e.summary) };
    return null;
  };

  const own = (raw.eventIds ?? []).map((id) => eventById.get(id)).filter((e): e is ScreenEvent => !!e);
  // The model names the moment's event and writes its label separately, and
  // the two can disagree (a label about one case, the event of another). The
  // named event is used only if it belongs to the step and its case is the
  // one the label talks about; otherwise the step's own event for that case.
  const labelText = raw.momentLabel ?? "";
  const fitsLabel = (e: ScreenEvent) => !e.entity || !/[A-Za-z]*-?\d{2,}/.test(labelText) || labelText.includes(e.entity.id);
  const namedEvent = eventById.get(raw.momentEventId ?? "");
  if (namedEvent && (own.length === 0 || own.includes(namedEvent)) && fitsLabel(namedEvent)) {
    const named = fromEvent(namedEvent);
    if (named) return named;
  }
  for (const e of own.filter(fitsLabel)) {
    const m = fromEvent(e);
    if (m) return m;
  }
  const frame = frameById.get(raw.frameId ?? "");
  if (frame) return { t: frame.t, frameId: frame.id, label: label(frame.t, "screen") };
  for (const e of [...own].reverse()) {
    const m = fromEvent(e);
    if (m) return m;
  }
  const anchor = eventById.get(raw.momentEventId ?? "") ?? own[own.length - 1];
  if (anchor) {
    const near = nearestFrame(frames, anchor.t);
    if (near) return { t: anchor.t, frameId: near.id, label: label(anchor.t, anchor.summary) };
  }
  return null;
}

// Names a check may use besides the fact keys of the session: the action the
// person is about to take, and the boolean literals.
const ALWAYS_ALLOWED = new Set(["action", "true", "false"]);

const TOKEN = /\s+|'[^']*'|"[^"]*"|\d+(?:\.\d+)?|[A-Za-z_]\w*|==|!=|>=|<=|&&|\|\||[!<>()]/y;

// The fact keys seen in a session's events: what a check can be evaluated against.
export function factKeysOf(events: ScreenEvent[]): Set<string> {
  return new Set(events.flatMap((e) => Object.keys(e.facts ?? {})));
}

// True if the expression only uses literals, comparison or boolean operators
// and names from `fields` (the fact keys of the session). Without `fields`
// any identifier is accepted and only the syntax is checked.
export function isValidExpr(expr: unknown, fields?: Set<string>): expr is string {
  if (typeof expr !== "string" || !expr.trim()) return false;
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < expr.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(expr);
    if (!m || m[0].length === 0) return false;
    if (fields && /^[A-Za-z_]/.test(m[0]) && !ALWAYS_ALLOWED.has(m[0]) && !fields.has(m[0])) return false;
    pos += m[0].length;
  }
  return true;
}

// Keeps a check only when it is fully expressible over the case facts of the
// session. The plain language rule stays the source of truth either way.
export function cleanCheck(raw: unknown, fields?: Set<string>): GuardrailCheck | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!isValidExpr(r.when, fields)) return undefined;
  const require = isValidExpr(r.require, fields) ? r.require : undefined;
  const forbid = isValidExpr(r.forbid, fields) ? r.forbid : undefined;
  if (!require && !forbid) return undefined;
  // A clause the model wrote but that does not parse makes the whole check unreliable.
  if ((r.require && !require) || (r.forbid && !forbid)) return undefined;
  return { when: r.when, ...(require ? { require } : {}), ...(forbid ? { forbid } : {}) };
}

export const GUARDRAIL_TYPES = ["limit", "exception", "stop_and_ask", "never"] as const;

export function cleanType(raw: unknown): (typeof GUARDRAIL_TYPES)[number] {
  return (GUARDRAIL_TYPES as readonly string[]).includes(raw as string)
    ? (raw as (typeof GUARDRAIL_TYPES)[number])
    : "limit";
}

export const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
