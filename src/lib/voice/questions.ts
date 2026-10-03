import { warmSession } from "../llm";
import { newId } from "../store";
import type { Question, QuestionKind, ScreenEvent, TranscriptItem } from "../types";
import { MAX_EVENT_AGE_MS, MAX_QUESTIONS_PER_WINDOW, MIN_QUESTION_GAP_MS, QUESTION_WINDOW_MS } from "./pause";

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

const JUDGMENT_ACTIONS = /hold|approv|reject|rerout|escalat|return|block|stop|cancel|forward|flag|dispute|defer|split/i;

// Events that look like a decision instead of routine navigation.
export function isJudgmentEvent(e: ScreenEvent) {
  if (e.kind === "field_change") return true;
  if (e.kind === "action") {
    const what = `${e.action ?? ""} ${e.summary}`;
    return JUDGMENT_ACTIONS.test(what);
  }
  return false;
}

const SYSTEM = `You help an apprentice who watches an expert do screen work and may ask a few short spoken questions.
You receive the screen events so far, everything said so far, and the questions that already exist.

Find the judgment calls: moments where the expert overrode a default value, held something back, rerouted or escalated it, stopped, or did an extra step that a newcomer would not know to do. Routine steps (opening the next item, opening a document to read it, a normal save) are not judgment calls.

For each judgment call that has no question yet, write up to two candidate questions:
- kind "reason": why they did it. Example: "You moved that one to capex. What made you do that?"
- kind "guardrail": the limit or the stop-and-ask rule behind it. Examples: "Is there a case where you would post capex without an asset number?", "Is there an amount above which you would not decide this yourself?", "When would you stop here and ask someone?"
Use kind "exception" only for a case that was not seen at all.

Rules for a question:
- One short spoken sentence, two at most. Start from what was visible ("You put the Brandt invoice on hold.") and then ask. Plain words, no ids unless needed to point at the thing.
- Never ask what the screen already answers (which value, which supplier, what amount).
- Set "explained": true when the expert has already said that reason or that rule aloud, before or after the event, or when the screen makes it obvious. A reason given aloud does not explain the guardrail unless the limit itself was stated.
- Tie each question to the eventIds it is about.

Also list in "explainedIds" the ids of existing queued questions that the expert has since answered aloud without being asked.

Return JSON: {"candidates":[{"kind":"reason"|"guardrail"|"exception","text":string,"eventIds":string[],"explained":boolean}],"explainedIds":string[]}
Each message contains the complete current state. Ignore the state from earlier messages.`;

const fmtT = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function buildPrompt(input: NextQuestionInput) {
  const events = input.events
    .map((e) => `${e.id} [${fmtT(e.t)}] ${e.kind}${e.action ? `/${e.action}` : ""}: ${e.summary}`)
    .join("\n");
  const said = input.transcript
    .map((x) => `[${fmtT(x.t)}] ${x.speaker}: ${x.text}`)
    .join("\n");
  const existing = input.questions
    .map((q) => `${q.id} (${q.status}, ${q.kind}, about ${q.eventIds.join(",") || "nothing on screen"}): ${q.text}`)
    .join("\n");
  const likely = input.events.filter(isJudgmentEvent).map((e) => e.id).join(", ");
  return `Now: ${fmtT(input.now)}

Screen events:
${events || "(none)"}

Events that changed a value or routed the item somewhere else (cover each of these, either with questions or, if a question for it exists, not at all): ${likely || "(none)"}

Said so far:
${said || "(nothing)"}

Existing questions:
${existing || "(none)"}`;
}

type LLMOut = { candidates?: Candidate[]; explainedIds?: string[] };

const KINDS: QuestionKind[] = ["reason", "guardrail", "exception"];

function sanitize(out: LLMOut, events: ScreenEvent[]): { candidates: Candidate[]; explainedIds: string[] } {
  const ids = new Set(events.map((e) => e.id));
  const candidates = (Array.isArray(out.candidates) ? out.candidates : [])
    .filter((c) => c && typeof c.text === "string" && c.text.trim() && KINDS.includes(c.kind))
    .map((c) => ({
      kind: c.kind,
      text: c.text.trim(),
      eventIds: (Array.isArray(c.eventIds) ? c.eventIds : []).filter((id) => ids.has(id)),
      explained: c.explained === true,
    }));
  const explainedIds = (Array.isArray(out.explainedIds) ? out.explainedIds : []).filter((x) => typeof x === "string");
  return { candidates, explainedIds };
}

// 2: the expert overrode a default, held, rerouted or stopped. 1: filled in
// something extra. 0: routine.
export function judgmentWeight(e: ScreenEvent) {
  if (e.kind === "action") return isJudgmentEvent(e) ? 2 : 0;
  if (e.kind === "field_change") return e.before && e.after && e.before !== e.after ? 2 : 1;
  return 0;
}

const CAUSAL = /\b(because|since|so it|so that|always|never|only if|unless|otherwise|has to|have to|must|needs? to|rule)\b/i;

// Fallback without a model. Coarser wording, same structure.
export function ruleCandidates(input: NextQuestionInput): Candidate[] {
  const out: Candidate[] = [];
  const covered = new Set(input.questions.flatMap((q) => q.eventIds));
  for (const e of input.events) {
    if (!isJudgmentEvent(e) || covered.has(e.id)) continue;
    // The expert talked about it with a causal phrase close to the event.
    const explained = input.transcript.some(
      (x) => x.speaker !== "agent" && x.t > e.t - 20_000 && x.t < e.t + 15_000 && CAUSAL.test(x.text),
    );
    const what = e.summary.replace(/\.$/, "");
    if (e.kind === "field_change" && e.before && e.after) {
      const field = (e.field ?? "that field").replace(/_/g, " ");
      out.push({
        kind: "reason",
        text: `You changed the ${field} from ${e.before} to ${e.after}. What made you do that?`,
        eventIds: [e.id],
        explained,
      });
      out.push({
        kind: "guardrail",
        text: `Is there a limit that decides when the ${field} has to change, and when would you ask someone first?`,
        eventIds: [e.id],
        explained: false,
      });
    } else if (e.kind === "field_change") {
      const field = (e.field ?? "that field").replace(/_/g, " ");
      out.push({
        kind: "guardrail",
        text: `You filled in the ${field} before going on. Is there a case where you would go ahead without it?`,
        eventIds: [e.id],
        explained: false,
      });
    } else {
      out.push({ kind: "reason", text: `${what}. Why did you do that instead of posting it?`, eventIds: [e.id], explained });
      out.push({
        kind: "guardrail",
        text: `${what}. Is that always the rule, and who decides what happens next?`,
        eventIds: [e.id],
        explained: false,
      });
    }
  }
  return out;
}

async function llmCandidates(input: NextQuestionInput, timeoutMs: number) {
  const session = warmSession("voice-questions", { system: SYSTEM, model: "haiku", maxCalls: 12 });
  const out = await Promise.race([
    session.askJSON<LLMOut>(buildPrompt(input)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("question model timed out")), timeoutMs)),
  ]);
  return sanitize(out, input.events);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

// Deterministic choice among queued questions.
export function pickQuestion(questions: Question[], events: ScreenEvent[], now: number): { question: Question | null; reason: string } {
  const live = questions
    .filter((q) => q.askedIn === "capture" && q.askedAt !== undefined && (q.status === "asked" || q.status === "answered"))
    .sort((a, b) => a.askedAt! - b.askedAt!);

  const lastAsked = live[live.length - 1]?.askedAt;
  if (lastAsked !== undefined && now - lastAsked < MIN_QUESTION_GAP_MS) {
    return { question: null, reason: `min gap: last question ${Math.round((now - lastAsked) / 1000)} s ago` };
  }
  if (live.filter((q) => now - q.askedAt! < QUESTION_WINDOW_MS).length >= MAX_QUESTIONS_PER_WINDOW) {
    return { question: null, reason: "live budget used up; the rest waits for the debrief" };
  }

  const eventT = new Map(events.map((e) => [e.id, e.t]));
  const eventW = new Map(events.map((e) => [e.id, judgmentWeight(e)]));
  const newestEvent = (q: Question) => Math.max(-Infinity, ...q.eventIds.map((id) => eventT.get(id) ?? -Infinity));
  const weight = (q: Question) => Math.max(0, ...q.eventIds.map((id) => eventW.get(id) ?? 0));
  // Events that already had a live question are not asked about twice in a row
  // with the same kind.
  const askedKey = new Set(live.flatMap((q) => q.eventIds.map((id) => `${id}:${q.kind}`)));

  const fresh = questions
    .filter((q) => q.status === "queued" && q.eventIds.length > 0)
    .filter((q) => !q.eventIds.some((id) => askedKey.has(`${id}:${q.kind}`)))
    .map((q) => ({ q, t: newestEvent(q), w: weight(q) }))
    .filter((x) => x.t <= now && now - x.t <= MAX_EVENT_AGE_MS)
    // Overrides, holds, reroutes and stops first, then the most recent.
    .sort((a, b) => b.w - a.w || b.t - a.t);
  if (fresh.length === 0) return { question: null, reason: "nothing recent on screen that needs a question" };

  const hadGuardrail = live.some((q) => q.kind === "guardrail");
  const guardrails = fresh.filter((x) => x.q.kind === "guardrail");
  const liveEventIds = new Set(live.flatMap((q) => q.eventIds));

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
  const untouched = sameMoment.filter((x) => !x.q.eventIds.some((id) => liveEventIds.has(id)));
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
  const judgment = input.events.filter(isJudgmentEvent);
  const said = input.transcript.filter((x) => x.speaker !== "agent");
  const stateKey = `${judgment.map((e) => e.id).join(",")}|${said.length}`;

  let analysis: Analysis | undefined = opts.cacheKey ? cache.get(opts.cacheKey) : undefined;
  let source: NextQuestionResult["source"] = "cache";
  if (!analysis || analysis.key !== stateKey) {
    if (judgment.length === 0) {
      analysis = { key: stateKey, candidates: [], explainedIds: [], source: "rules" };
    } else {
      try {
        if (opts.useLLM === false) throw new Error("model disabled");
        const out = await llmCandidates(input, opts.timeoutMs ?? 15_000);
        // The model sometimes leaves out an event. For clear judgment calls
        // the rule-based candidates fill what is missing.
        const strong = new Set(input.events.filter((e) => judgmentWeight(e) === 2).map((e) => e.id));
        const has = (id: string, kind: QuestionKind) =>
          [...out.candidates, ...input.questions].some((c) => c.kind === kind && c.eventIds.includes(id));
        const fill = ruleCandidates(input).filter((c) => strong.has(c.eventIds[0]) && !has(c.eventIds[0], c.kind));
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
  for (const id of analysis.explainedIds) {
    const q = questions.find((x) => x.id === id && x.status === "queued");
    if (q) {
      q.status = "dropped";
      upserts.push(q);
    }
  }
  for (const c of analysis.candidates) {
    const duplicate = questions.find(
      (q) =>
        norm(q.text) === norm(c.text) ||
        (q.kind === c.kind && c.eventIds.length > 0 && c.eventIds.some((id) => q.eventIds.includes(id))),
    );
    if (duplicate) {
      if (c.explained && duplicate.status === "queued") {
        duplicate.status = "dropped";
        upserts.push(duplicate);
      }
      continue;
    }
    const q: Question = {
      id: newId("q"),
      kind: c.kind,
      text: c.text,
      eventIds: c.eventIds,
      // Explained aloud or visible on screen: kept for the record, never asked.
      status: c.explained ? "dropped" : "queued",
    };
    questions.push(q);
    upserts.push(q);
  }

  const { question, reason } = pickQuestion(questions, input.events, input.now);
  return { question, reason, upserts, source };
}
