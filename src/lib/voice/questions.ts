import { warmSession } from "../llm";
import { newId } from "../store";
import type { Question, QuestionKind, ScreenEvent, TranscriptItem } from "../types";
import { actionClass, canonicalEventIds, decisionKey } from "../capture/dedupe";
import { MAX_EVENT_AGE_MS, MAX_QUESTIONS_PER_WINDOW, QUESTION_WINDOW_MS, minGapAfter } from "./pause";

// Server-only. Decides which single question the interviewer should ask now.
//
// Two stages:
// 1. Candidates. A model reads the events and the transcript and writes, for
//    each judgment call (override of a default, hold, reroute, stop, an
//    unusual extra step), a "reason" question and a "guardrail" question, and
//    marks what the expert already explained aloud or the screen already
//    answers. A rule-based fallback does the same without a model.
// 2. Pick. Deterministic rules choose one candidate: recent enough to still be
//    on screen, not explained, within the live budget, and a guardrail
//    question among the first three.

export type Candidate = {
  kind: QuestionKind;
  text: string;
  eventIds: string[];
  // The expert already gave this reason or rule aloud, or the screen shows it.
  explained: boolean;
  // The expert's words that explain it, copied from the transcript. Without
  // a quote that can be found in the transcript, `explained` is not believed.
  explainedBy?: string;
};

export type NextQuestionInput = {
  events: ScreenEvent[];
  transcript: TranscriptItem[];
  questions: Question[];
  now: number; // session time in ms
};

export type NextQuestionResult = {
  // The question to ask now, or null. Its status is still "queued": the caller
  // marks it "asked" once the agent has spoken it.
  question: Question | null;
  // Why nothing was picked, or which rule picked it.
  reason: string;
  // Questions to insert or update in the store (new candidates as "queued",
  // explained ones as "dropped").
  upserts: Question[];
  source: "llm" | "rules" | "cache";
};

// A guardrail question must be among the first this many live questions.
export const GUARDRAIL_WITHIN_FIRST = 3;

// Actions that take a case off its normal path, in any workflow.
const DIVERTING = /hold|held|reject|declin|rerout|escalat|return|block|stop|forward|refer|flag|dispute|defer|split|sen[dt][ _](it[ _])?(to|for|back)/i;
// An action that was only requested (the confirmation box is open) or was
// cancelled is not a decision yet. The committed action is the decision.
const UNCOMMITTED = /requested|confirmation (open|shown)|cancelled|canceled/i;

const sameText = (a: string | undefined, b: string | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

// Events that are a decision instead of routine navigation: a committed
// action, or a field that was moved away from the value it had.
export function isJudgmentEvent(e: ScreenEvent) {
  if (e.kind === "field_change") return e.after !== undefined && e.after !== "" && !sameText(e.before, e.after);
  if (e.kind === "action") return e.committed !== false && !UNCOMMITTED.test(e.summary) && actionClass(e.action, e.summary) !== "reopen";
  return false;
}

// The judgment events questions are written about: one per decision. Repeats
// of the same event (a vision event that describes a DOM event again) and
// later events of the same decision are left out.
export function decisionEvents(events: ScreenEvent[]): ScreenEvent[] {
  const canon = canonicalEventIds(events);
  const seen = new Set<string>();
  const out: ScreenEvent[] = [];
  // The value each field started with, per case: the default.
  const startValue = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.kind === "field_change" && e.before !== undefined) {
      const key = decisionKey(e);
      if (!startValue.has(key)) startValue.set(key, e.before);
      // Back to the default is not a decision.
      else if (sameText(startValue.get(key), e.after)) continue;
    }
    if (!isJudgmentEvent(e) || canon.get(e.id) !== e.id) continue;
    const key = decisionKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// Maps every event id to the decision it belongs to, so a question about a
// repeat or about the request that preceded a commit counts as a question
// about that decision.
function decisionIndex(events: ScreenEvent[]) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const keyOf = (id: string) => {
    const e = byId.get(id);
    return e ? decisionKey(e) : `event:${id}`;
  };
  return { keysOf: (ids: string[]) => new Set(ids.map(keyOf)) };
}

const SYSTEM = `You help an apprentice who watches an expert do screen work and may ask a few short spoken questions.
You receive the screen events so far, everything said so far, and the questions that already exist.

Find the judgment calls: moments where the expert overrode a default value, held something back, rerouted or escalated it, stopped, or did an extra step that a newcomer would not know to do. Routine steps (opening the next item, opening a document to read it, the normal action that moves an ordinary case along) are not judgment calls, unless the expert did something unusual to get there.

For each judgment call that has no question yet, write up to two candidate questions:
- kind "reason": why they did it. Example: "You changed that one from normal to urgent. What made you do that?"
- kind "guardrail": the limit or the stop-and-ask rule behind it. Examples: "Would you ever send one on without filling that in?", "Is there a limit above which you would not decide this yourself?", "When would you stop here and ask someone?"
Use kind "exception" only for a case that was not seen at all.

Rules for a question:
- One short spoken sentence, two at most. Start from what was visible ("You put that request on hold.") and then ask. Plain words, the way a colleague would point at it: a name or "that one", not an id, unless the id is needed to tell things apart. Use the words of this session's screen events, not the wording of the examples above.
- Never ask what the screen already answers (which value, which name, what number).
- Set "explained": true only when the expert has already said that reason or that rule aloud, and copy the words that say it into "explainedBy", exactly as they appear under "Said so far". A reason given aloud does not explain the guardrail: a guardrail question is explained only when the expert stated the limit, the condition or who to ask ("three years or more", "over a thousand", "always", "never without", "I ask my manager"). Describing the case ("that one is urgent") is a reason, not a limit.
- Tie each question to the eventIds it is about, using the ids from the list of decisions.
- At most one "reason" and one "guardrail" question per decision.

Also list in "explained" the existing queued questions that the expert has since answered aloud without being asked, each with the words that answer it.

Return JSON: {"candidates":[{"kind":"reason"|"guardrail"|"exception","text":string,"eventIds":string[],"explained":boolean,"explainedBy":string}],"explained":[{"id":string,"explainedBy":string}]}
Each message contains the complete current state. Ignore the state from earlier messages.`;

const fmtT = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function buildPrompt(input: NextQuestionInput) {
  const events = input.events
    .map((e) => `${e.id} [${fmtT(e.t)}] ${e.kind}${e.action ? `/${e.action}${e.committed === false ? " (not confirmed yet)" : ""}` : ""}: ${e.summary}`)
    .join("\n");
  const said = input.transcript
    .map((x) => `[${fmtT(x.t)}] ${x.speaker}: ${x.text}`)
    .join("\n");
  const existing = input.questions
    .map((q) => `${q.id} (${q.status}, ${q.kind}, about ${q.eventIds.join(",") || "nothing on screen"}): ${q.text}`)
    .join("\n");
  const likely = decisionEvents(input.events).map((e) => e.id).join(", ");
  return `Now: ${fmtT(input.now)}

Screen events:
${events || "(none)"}

The case on screen: ${caseLine(input.events)}

Decisions (events that changed a value or routed the item somewhere else; cover each of these, either with questions or, if a question for it exists, not at all): ${likely || "(none)"}

Said so far:
${said || "(nothing)"}

Existing questions:
${existing || "(none)"}`;
}

// The facts of the newest case, so questions can use its name and so the
// model can see what the screen already answers.
function caseLine(events: ScreenEvent[]) {
  const last = [...events].reverse().find((e) => e.facts && Object.keys(e.facts).length > 0);
  if (!last?.facts) return "(no facts read)";
  return `${last.entity ? `${last.entity.type} ${last.entity.id} ` : ""}${JSON.stringify(last.facts)}`;
}

type LLMOut = {
  candidates?: Candidate[];
  explained?: Array<{ id?: string; explainedBy?: string }>;
};

const KINDS: QuestionKind[] = ["reason", "guardrail", "exception"];

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Words that state a limit, a condition or an escalation. A guardrail
// question only counts as explained when the quoted words contain one.
const STATES_LIMIT =
  /\d|\b(over|above|below|under|more than|less than|at least|at most|up to|limit|threshold|always|never|only|unless|except|every|whenever|must|has to|have to|need(s)? to|not allowed|ask|or more|or less|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|approval|approve[sd]?|sign[- ]?off|decides?|manager|supervisor|boss)\b/i;

// "Explained" is believed only with the expert's own words behind it: the
// quote has to be in the transcript, and for a guardrail question it has to
// state a limit. Otherwise the question stays open.
export function isExplained(kind: QuestionKind, explainedBy: unknown, transcript: TranscriptItem[]): boolean {
  if (typeof explainedBy !== "string") return false;
  const quote = words(explainedBy);
  if (quote.split(" ").length < 2) return false;
  const said = transcript.filter((x) => x.speaker !== "agent").some((x) => words(x.text).includes(quote));
  if (!said) return false;
  return kind === "guardrail" ? STATES_LIMIT.test(explainedBy) : true;
}

function sanitize(out: LLMOut, input: NextQuestionInput): { candidates: Candidate[]; explainedIds: string[] } {
  const ids = new Set(input.events.map((e) => e.id));
  const candidates = (Array.isArray(out.candidates) ? out.candidates : [])
    .filter((c) => c && typeof c.text === "string" && c.text.trim() && KINDS.includes(c.kind))
    .map((c) => ({
      kind: c.kind,
      text: spoken(c.text),
      eventIds: (Array.isArray(c.eventIds) ? c.eventIds : []).filter((id) => ids.has(id)),
      explained: c.explained === true && isExplained(c.kind, c.explainedBy, input.transcript),
    }));
  const kindOf = new Map(input.questions.map((q) => [q.id, q.kind]));
  const explainedIds = (Array.isArray(out.explained) ? out.explained : [])
    .filter((x) => x && typeof x.id === "string" && kindOf.has(x.id) && isExplained(kindOf.get(x.id)!, x.explainedBy, input.transcript))
    .map((x) => x.id as string);
  return { candidates, explainedIds };
}

// Question text is read aloud: plain punctuation, single spaces.
const spoken = (text: string) =>
  text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/ ,/g, ",")
    .trim();

// 2: the expert overrode a default, held, rerouted or stopped. 1: filled in
// something extra, or took the normal action. 0: routine.
export function judgmentWeight(e: ScreenEvent) {
  if (!isJudgmentEvent(e)) return 0;
  if (e.kind === "action") return DIVERTING.test(`${e.action ?? ""} ${e.summary}`) ? 2 : 1;
  return e.before ? 2 : 1;
}

const CAUSAL = /\b(because|'?cause|since|so it|so that|always|never|only if|unless|otherwise|has to|have to|must|needs? to|rule)\b/i;

const firstWord = (v: unknown) => (typeof v === "string" ? v.trim().split(/\s+/)[0] : "");

// How the thing is called aloud: "Jonas", "the Harbour request", "order 4472", "that one".
function thingName(e: ScreenEvent) {
  const type = (e.entity?.type ?? "").replace(/_/g, " ");
  const facts = e.facts ?? {};
  // A fact that names the case: "name", or a key that ends in "_name".
  const nameKey = Object.keys(facts).find((k) => k === "name") ?? Object.keys(facts).find((k) => /_name$/.test(k));
  const name = nameKey ? firstWord(facts[nameKey]) : "";
  if (name && /^\p{Lu}/u.test(name)) return nameKey === "name" ? name : `the ${name} ${type || "one"}`;
  if (e.entity) return `${type} ${e.entity.id}`;
  return "that one";
}

// The label the screen shows for a value, read from the event summary:
// "Track changed from Standard loop to Fast track" gives "Fast track" for "fast".
function shownValue(e: ScreenEvent, which: "before" | "after") {
  const raw = e[which] ?? "";
  const m = e.summary.match(which === "after" ? /\b(?:to|as)\s+(.+?)\s*$/i : /\bfrom\s+(.+?)\s+to\s/i);
  const label = m?.[1]?.replace(/[.]$/, "") ?? "";
  return label && label.toLowerCase().includes(raw.toLowerCase().slice(0, 4)) ? label : raw;
}

// "hold" -> "put Jonas on hold"; "escalate" -> "escalated Jonas".
function actionPhrase(cls: string, label: string, thing: string) {
  if (cls === "hold") return `put ${thing} on hold`;
  if (cls === "escalate") return `sent ${thing} on to someone else`;
  if (cls === "reject") return `rejected ${thing}`;
  if (cls === "approve") return `approved ${thing}`;
  if (cls === "advance") return `advanced ${thing}`;
  return `chose "${label}" for ${thing}`;
}

const gerund = (verb: string) => {
  const v = verb.split(" ")[0];
  return `${/e$/.test(v) && !/ee$/.test(v) ? v.slice(0, -1) : v}ing`;
};

// Fallback without a model, and the fill-in for decisions the model left
// out. One reason and one guardrail question per decision, built from the
// event itself, worded as something a colleague would say.
export function ruleCandidates(input: NextQuestionInput): Candidate[] {
  const out: Candidate[] = [];
  const decisions = decisionEvents(input.events);
  // The normal way a case leaves the desk in this session: the committed
  // action that does not divert it, if one was seen.
  const usual = decisions.find((e) => e.kind === "action" && judgmentWeight(e) === 1);
  const usualVerb = usual ? (usual.action ?? actionClass(usual.action, usual.summary) ?? "").replace(/_/g, " ") : "";
  for (const e of decisions) {
    // The expert talked about it with a causal phrase close to the event
    // (transcript times are the start of each utterance).
    const explained = input.transcript.some(
      (x) => x.speaker !== "agent" && x.t > e.t - 5_000 && x.t < e.t + 10_000 && CAUSAL.test(x.text),
    );
    // A limit, a condition or who decides was said aloud around the event.
    const limitStated = input.transcript.some(
      (x) => x.speaker !== "agent" && x.t > e.t - 5_000 && x.t < e.t + 45_000 && STATES_LIMIT.test(x.text),
    );
    const thing = thingName(e);
    const add = (kind: QuestionKind, text: string, isExplained = false) =>
      out.push({ kind, text, eventIds: [e.id], explained: isExplained });
    if (e.kind === "field_change") {
      const field = (e.field ?? "that field").replace(/_/g, " ");
      const on = thing === "that one" ? "" : ` for ${thing}`;
      if (e.before && e.after) {
        add("reason", `You changed the ${field}${on} from ${shownValue(e, "before")} to ${shownValue(e, "after")}. What made you do that?`, explained);
        add("guardrail", `Is there a limit that decides when the ${field} has to be ${shownValue(e, "after")}, and when would you stop and ask someone first?`, limitStated);
      } else {
        add("guardrail", `You set the ${field}${on} before going on. Is there a case where you would go ahead without it?`, limitStated);
      }
      continue;
    }
    const cls = actionClass(e.action, e.summary) ?? "that";
    const label = (e.action ?? cls).replace(/_/g, " ");
    // "Application C-103 escalated to the founders" read as "escalated Priya to the founders".
    const tail = e.entity ? e.summary.split(e.entity.id)[1]?.trim().match(/^(\p{Ll}+ed|put|sent|held|set|kept)\b\s*(.*)$/u) : null;
    const did = tail ? `${tail[1]} ${thing}${tail[2] ? ` ${tail[2].replace(/[.]$/, "")}` : ""}` : actionPhrase(cls, label, thing);
    if (judgmentWeight(e) === 2) {
      const instead = usualVerb && usual && decisionKey(usual) !== decisionKey(e) ? ` instead of ${gerund(usualVerb)}` : "";
      add("reason", `You ${did}${instead}. Why?`, explained);
      add("guardrail", `Is there a rule that decides when you do that, and who decides what happens next?`, limitStated);
    } else {
      add("reason", `You ${did}. What did you check before you did that?`, explained);
      add("guardrail", `Is there a limit that decides this, and when would you stop and ask someone first?`, limitStated);
    }
  }
  return out;
}

async function llmCandidates(input: NextQuestionInput, timeoutMs: number) {
  const session = warmSession("voice-questions-v3", { system: SYSTEM, model: "haiku", maxCalls: 30 });
  const out = await Promise.race([
    session.askJSON<LLMOut>(buildPrompt(input)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("question model timed out")), timeoutMs)),
  ]);
  return sanitize(out, input);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

// Deterministic choice among queued questions.
export function pickQuestion(questions: Question[], events: ScreenEvent[], now: number): { question: Question | null; reason: string } {
  const live = questions
    .filter((q) => q.askedIn === "capture" && q.askedAt !== undefined && (q.status === "asked" || q.status === "answered"))
    .sort((a, b) => a.askedAt! - b.askedAt!);

  const lastAsked = live[live.length - 1]?.askedAt;
  const inWindow = live.filter((q) => now - q.askedAt! < QUESTION_WINDOW_MS).length;
  if (lastAsked !== undefined && now - lastAsked < minGapAfter(inWindow)) {
    return { question: null, reason: `min gap: last question ${Math.round((now - lastAsked) / 1000)} s ago` };
  }
  if (inWindow >= MAX_QUESTIONS_PER_WINDOW) {
    return { question: null, reason: "live budget used up; the rest waits for the debrief" };
  }

  const eventT = new Map(events.map((e) => [e.id, e.t]));
  const eventW = new Map(events.map((e) => [e.id, judgmentWeight(e)]));
  const newestEvent = (q: Question) => Math.max(-Infinity, ...q.eventIds.map((id) => eventT.get(id) ?? -Infinity));
  const weight = (q: Question) => Math.max(0, ...q.eventIds.map((id) => eventW.get(id) ?? 0));
  // A decision that already had a live question of one kind is not asked
  // about again with the same kind, whichever of its events the question names.
  const { keysOf } = decisionIndex(events);
  const askedKey = new Set(live.flatMap((q) => [...keysOf(q.eventIds)].map((key) => `${key}:${q.kind}`)));

  const fresh = questions
    .filter((q) => q.status === "queued" && q.eventIds.length > 0)
    .filter((q) => ![...keysOf(q.eventIds)].some((key) => askedKey.has(`${key}:${q.kind}`)))
    .map((q) => ({ q, t: newestEvent(q), w: weight(q) }))
    .filter((x) => x.t <= now && now - x.t <= MAX_EVENT_AGE_MS)
    // Overrides, holds, reroutes and stops first, then the most recent.
    .sort((a, b) => b.w - a.w || b.t - a.t);
  if (fresh.length === 0) return { question: null, reason: "nothing recent on screen that needs a question" };

  const hadGuardrail = live.some((q) => q.kind === "guardrail");
  const guardrails = fresh.filter((x) => x.q.kind === "guardrail");
  const liveKeys = new Set(live.flatMap((q) => [...keysOf(q.eventIds)]));

  // The last slot of the first three is reserved for a guardrail question.
  if (!hadGuardrail && live.length >= GUARDRAIL_WITHIN_FIRST - 1) {
    if (guardrails.length > 0) return { question: guardrails[0].q, reason: "guardrail question required among the first three" };
    return { question: null, reason: "waiting for a guardrail question (none of the first two was one)" };
  }
  // From the second question on, prefer a guardrail until one has been asked.
  if (!hadGuardrail && live.length >= 1 && guardrails.length > 0) {
    return { question: guardrails[0].q, reason: "no guardrail question yet; preferring one" };
  }

  // Otherwise: newest event first. For an event not asked about yet, the
  // reason comes before the guardrail.
  const sameMoment = fresh.filter((x) => x.t === fresh[0].t && x.w === fresh[0].w);
  const untouched = sameMoment.filter((x) => ![...keysOf(x.q.eventIds)].some((key) => liveKeys.has(key)));
  const pool = untouched.length > 0 ? untouched : sameMoment;
  const best = pool.find((x) => x.q.kind === "reason") ?? pool[0];
  return { question: best.q, reason: `${best.w === 2 ? "override, hold or reroute" : "most recent step"} (${best.q.kind})` };
}

// One analysis per session state: the model is only called when events or
// expert speech were added since the last call.
type Analysis = { key: string; candidates: Candidate[]; explainedIds: string[]; source: "llm" | "rules" };
const cache = ((globalThis as Record<string, unknown>).__voiceQuestionCache ??= new Map()) as Map<string, Analysis>;

// Off the record: the cached analysis may hold candidates about purged events.
export function forgetQuestionAnalysis(sessionId: string) {
  cache.delete(sessionId);
}

export async function nextQuestion(
  input: NextQuestionInput,
  opts: { cacheKey?: string; useLLM?: boolean; timeoutMs?: number } = {},
): Promise<NextQuestionResult> {
  const decisions = decisionEvents(input.events);
  const said = input.transcript.filter((x) => x.speaker !== "agent");
  const stateKey = `${decisions.map((e) => e.id).join(",")}|${said.length}`;
  const { keysOf } = decisionIndex(input.events);
  const shares = (a: Set<string>, b: Set<string>) => [...a].some((k) => b.has(k));

  let analysis: Analysis | undefined = opts.cacheKey ? cache.get(opts.cacheKey) : undefined;
  let source: NextQuestionResult["source"] = "cache";
  if (!analysis || analysis.key !== stateKey) {
    if (decisions.length === 0) {
      analysis = { key: stateKey, candidates: [], explainedIds: [], source: "rules" };
    } else {
      try {
        if (opts.useLLM === false) throw new Error("model disabled");
        const out = await llmCandidates(input, opts.timeoutMs ?? 15_000);
        // The model sometimes leaves out a decision. For clear judgment calls
        // the rule-based candidates fill what is missing. They never stand
        // next to a model-written question of the same kind for that decision.
        const strong = new Set(decisions.filter((e) => judgmentWeight(e) === 2).map((e) => e.id));
        const has = (c: Candidate) =>
          [...out.candidates, ...input.questions].some((x) => x.kind === c.kind && shares(keysOf(x.eventIds), keysOf(c.eventIds)));
        const fill = ruleCandidates(input).filter((c) => strong.has(c.eventIds[0]) && !has(c));
        analysis = { key: stateKey, candidates: [...out.candidates, ...fill], explainedIds: out.explainedIds, source: "llm" };
      } catch {
        analysis = { key: stateKey, candidates: ruleCandidates(input), explainedIds: [], source: "rules" };
      }
    }
    source = analysis.source;
    if (opts.cacheKey) cache.set(opts.cacheKey, analysis);
  }

  // Merge candidates into the question list.
  const questions = input.questions.map((q) => ({ ...q }));
  const upserts: Question[] = [];
  const touch = (q: Question) => {
    if (!upserts.includes(q)) upserts.push(q);
  };
  for (const id of analysis.explainedIds) {
    const q = questions.find((x) => x.id === id && x.status === "queued");
    if (q) {
      q.status = "dropped";
      touch(q);
    }
  }
  const decisionIds = new Set(decisions.map((e) => e.id));
  for (const c of analysis.candidates) {
    // A candidate has to be about a decision. One that only names an
    // uncommitted request or a repeat is moved to the decision it belongs to.
    const keys = keysOf(c.eventIds);
    const about = decisions.filter((e) => keys.has(decisionKey(e)));
    if (c.eventIds.length > 0 && about.length === 0) continue;
    const eventIds = c.eventIds.length > 0 ? about.map((e) => e.id) : [];
    const duplicate = questions.find(
      (q) => norm(q.text) === norm(c.text) || (q.kind === c.kind && eventIds.length > 0 && shares(keysOf(q.eventIds), keys)),
    );
    if (duplicate) {
      if (c.explained && duplicate.status === "queued") {
        duplicate.status = "dropped";
        touch(duplicate);
      } else if (analysis.source === "llm" && duplicate.status === "queued" && isTemplate(duplicate, input) && !isTemplate(c, input)) {
        // The model's wording replaces a rule-based one that was queued
        // while the model was not available.
        duplicate.text = c.text;
        touch(duplicate);
      }
      continue;
    }
    const q: Question = {
      id: newId("q"),
      kind: c.kind,
      text: c.text,
      eventIds,
      // Explained aloud: kept for the record, never asked.
      status: c.explained ? "dropped" : "queued",
    };
    questions.push(q);
    upserts.push(q);
  }
  // A queued guardrail question is dropped once the expert has stated the
  // limit in the answer to an earlier question about the same decision.
  for (const q of questions) {
    if (q.kind !== "guardrail" || q.status !== "queued" || q.eventIds.length === 0) continue;
    const keys = keysOf(q.eventIds);
    const answerIds = questions
      .filter((o) => o !== q && o.status === "answered" && shares(keysOf(o.eventIds), keys))
      .flatMap((o) => o.answerTranscriptIds ?? []);
    if (input.transcript.some((x) => answerIds.includes(x.id) && x.speaker !== "agent" && STATES_LIMIT.test(x.text))) {
      q.status = "dropped";
      touch(q);
    }
  }
  // Questions stored earlier about something that is not a decision (an
  // uncommitted request, a repeat) are not asked live.
  const askable = questions.filter((q) => q.eventIds.length === 0 || q.eventIds.some((id) => decisionIds.has(id)));

  const { question, reason } = pickQuestion(askable, input.events, input.now);
  return { question, reason, upserts, source };
}

// True when the text is one the rule-based fallback would write.
function isTemplate(q: { text: string }, input: NextQuestionInput) {
  return ruleCandidates({ ...input, questions: [] }).some((c) => norm(c.text) === norm(q.text));
}
