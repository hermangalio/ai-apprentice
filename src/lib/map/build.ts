import { llmJSON } from "../llm";
import { events as eventStore, frames as frameStore, questions as questionStore, sessions, transcript as transcriptStore, workMaps } from "../store";
import type { Frame, Gap, Guardrail, Question, Quote, ScreenEvent, TeachBack, TranscriptItem, WorkMap, WorkStep } from "../types";
import { fmtT, isDebriefDone } from "./debrief";
import { cleanCheck, cleanType, factKeysOf, isVerbatim, resolveMoment, resolveQuote, str, type RawQuote } from "./validate";

export { debriefContext, debriefStatus, isDebriefDone } from "./debrief";

// Server-only. Builds the draft Work Map from a capture session and finalizes
// it after the debrief. The model proposes; the code below decides what is
// kept: quotes must be verbatim, ids must exist, and anything that claims to
// be a rule without the expert's words behind it becomes a gap.

const CHECK_GUIDE = `A "check" is a machine-checkable form of a guardrail over the facts of the case on screen. Only write one when the rule can be expressed with the fields listed under "Case fields in this session" in the message; otherwise omit it. Use those field names exactly as listed, and values in the form shown there (for example the stored value 'fast', not the label "Fast track"). Besides those fields there is "action": the action the person is about to take, one of the action names listed there.
Operators: == != > >= < <= && || ! and parentheses. Strings in single quotes. A field on its own is true when it is set, yes or non-empty; !field is true when it is empty or no.
Shape: { "when": condition under which the rule applies, "require": what must then be true } or { "when": ..., "forbid": what must not happen }.
Patterns, with placeholder names (replace them with fields and actions of this session):
{ "when": "<flag_field> && <number_field> >= 3", "require": "<choice_field> == '<value>'" }   a condition that fixes the value of a field
{ "when": "<choice_field> == '<value>'", "forbid": "action == '<action>' && !<other_field>" }   never do the action while a field is empty
{ "when": "<text_field> == '<Name as on screen>'", "require": "action == '<action>'" }   a named case always gets one action
{ "when": "<flag_field>", "forbid": "action == '<action>'" }   never do the action yourself for such a case
Write a check for every guardrail whose condition can be expressed this way, including rules about one named value (a name, a place, a month). If the rule needs a fact that is not among the fields, omit the check.`;

// The fact keys and action names of a session with example values, for the
// prompt: checks are written against these and nothing else.
export function caseFieldGuide(events: ScreenEvent[]): string {
  const values = new Map<string, Set<string>>();
  for (const e of events) {
    for (const [k, v] of Object.entries(e.facts ?? {})) {
      if (v === undefined) continue;
      const seen = values.get(k) ?? values.set(k, new Set()).get(k)!;
      if (seen.size < 4) seen.add(typeof v === "string" ? `'${v}'` : String(v));
    }
  }
  const typeOf = (vals: string[]) => (vals.every((v) => v === "true" || v === "false") ? "yes/no" : vals.every((v) => !v.startsWith("'")) ? "number" : "text");
  const fields = [...values].map(([k, set]) => `- ${k} (${typeOf([...set])}): ${[...set].join(", ")}`);
  const actions = [...new Set(events.filter((e) => e.kind === "action" && e.action).map((e) => `'${e.action}'`))];
  return [
    "Case fields in this session (name, type, values seen):",
    ...(fields.length ? fields : ["(no case facts were read; do not write checks)"]),
    `Action names seen: ${actions.length ? actions.join(", ") : "(none)"}`,
  ].join("\n");
}

const JUDGMENT_GAP_PREFIX = "This looked like a judgment call";

// The debrief is short: this many gaps at most, the most valuable first.
export const MAX_DEBRIEF_GAPS = 5;

type GapKind = "reason" | "guardrail" | "exception" | "other";

// What a gap question asks for, when its source did not say.
export function gapKind(question: string): GapKind {
  if (/\b(limit|threshold|always|every|rule|who (decides|releases|approves|signs)|ask (someone|first)|stop and ask|how (much|long)|until when|above|below|when (does|do|would|is|exactly))\b/i.test(question)) {
    return "guardrail";
  }
  if (/\b(never seen|not seen|did not occur|different from|unknown|what (do|would) you do (when|with|if))\b/i.test(question)) return "exception";
  if (/\b(why|what made you|reason|how come)\b/i.test(question)) return "reason";
  return "other";
}

const GAP_VALUE: Record<GapKind, number> = { guardrail: 4, reason: 3, exception: 2, other: 1 };

const pad = (n: number) => String(n).padStart(2, "0");

function eventLine(e: ScreenEvent) {
  const extra = [
    e.entity ? `${e.entity.type} ${e.entity.id}` : "",
    e.field ? `field ${e.field}: "${e.before ?? ""}" -> "${e.after ?? ""}"` : "",
    e.action ? `action ${e.action}${e.committed ? " (committed)" : ""}` : "",
    e.facts ? `facts ${JSON.stringify(e.facts)}` : "",
  ].filter(Boolean);
  return `[${e.id} ${fmtT(e.t)} ${e.kind}] ${e.summary}${extra.length ? ` | ${extra.join(" | ")}` : ""}`;
}

const transcriptLine = (x: TranscriptItem) => `[${x.id} ${fmtT(x.t)} ${x.speaker}] ${x.text}`;

const normQ = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function askModel<T>(system: string, prompt: string): Promise<T> {
  try {
    return await llmJSON<T>({ system, prompt, model: "sonnet" });
  } catch (first) {
    // One retry: a malformed JSON reply is the usual failure and is not sticky.
    console.warn("[map] model call failed, retrying once:", (first as Error).message);
    return await llmJSON<T>({ system, prompt, model: "sonnet" });
  }
}

// ---------------------------------------------------------------- draft

type RawStep = {
  title?: string;
  decision?: string;
  eventIds?: string[];
  momentEventId?: string;
  frameId?: string;
  momentLabel?: string;
  reason?: RawQuote;
  isJudgmentCall?: boolean;
};
type RawGuardrail = {
  stepIndex?: number;
  stepId?: string;
  type?: string;
  rule?: string;
  escalateTo?: string | null;
  check?: unknown;
  quote?: RawQuote;
  momentEventId?: string;
  momentLabel?: string;
};
type RawGap = { question?: string; why?: string; kind?: string; stepIndex?: number | null; questionId?: string | null };
type RawDraft = { steps?: RawStep[]; guardrails?: RawGuardrail[]; gaps?: RawGap[] };

const DRAFT_SYSTEM = `You are an apprentice who watched an expert do a task on screen and listened to them talk. You now write the first draft of a Work Map: the process as ordered steps, the decisions, the reasons in the expert's own words, the guardrails, and the things you still do not understand.

You receive screen events (with ids and times), the transcript of what was said during the task (with ids), and questions that were queued but not answered.

Return one JSON object:
{
  "steps": [
    {
      "title": "imperative, general, e.g. 'Set the priority'",
      "decision": "what the expert actually did at this step in this session, concrete, past tense, e.g. 'Moved from normal to urgent'",
      "eventIds": ["evt ids that belong to this step"],
      "momentEventId": "the single event that best shows this step on screen",
      "momentLabel": "what is on screen at that moment, no time, e.g. 'request R-2041, priority field'",
      "reason": { "transcriptId": "tr id", "text": "exact words copied from that expert transcript item" } or null,
      "isJudgmentCall": true or false
    }
  ],
  "guardrails": [
    {
      "stepIndex": 1-based index into steps,
      "type": "limit" | "exception" | "stop_and_ask" | "never",
      "rule": "the rule in one or two short sentences, close to the expert's wording",
      "escalateTo": "who to ask or hand over to, if the expert named someone" or null,
      "check": { "when": "...", "require": "..." } or { "when": "...", "forbid": "..." } or null,
      "quote": { "transcriptId": "tr id", "text": "exact words copied from that expert transcript item" },
      "momentEventId": "event that shows where the rule applied"
    }
  ],
  "gaps": [
    { "question": "...", "why": "what is unclear and why it matters", "kind": "reason" | "guardrail" | "exception", "stepIndex": 1-based index or null, "questionId": "id of a queued question this covers" or null }
  ]
}

Steps:
- Describe the process, not the log. One step per distinct kind of action, in the order it first happens. If the expert repeats the same action on several cases, that is one step. Usually 5 to 9 steps.
- Granularity: opening the work list and opening the next case are one step ("Open the next ..."). A routine check that every case gets (for example reading its history) is its own step. Setting a value the expert chooses deliberately and the committing action that follows are separate steps, and two different fields are two steps. A lookup that leads to a special decision (hold, reroute, hand to someone else) belongs to the step of that decision, not to the routine check.
- Every screen event belongs to exactly one step. A step that only happened for one case (a hold, a special routing) is still a step.
- isJudgmentCall is true only where the expert decided something a newcomer following the defaults would have done differently: overriding a default, holding instead of letting it through, routing to someone. Routine actions (open, read, fill in a required value, the normal action that moves the case on) are not judgment calls.
- reason: quote the expert only. Copy the words exactly from one transcript item; a whole item or a contiguous part of it. Never paraphrase inside "text". If the expert gave no reason for a step, use null.

Guardrails:
- A guardrail is a rule the expert stated: a limit (threshold or condition that changes what to do), an exception (a special case), a moment to stop and ask someone, or something never to do.
- Only include a guardrail if the expert's own words support it. The quote must be copied exactly from one expert transcript item. If you only suspect a rule from what happened on screen, put it in gaps as a question instead.
- A stated habit about a specific case or counterparty ("those always wait until someone has looked at them") is an exception guardrail, even when its scope is still unclear. Include it and also raise the scope as a gap.
- Attach each guardrail to the step where it applies.
${CHECK_GUIDE}

Gaps:
- Gaps are follow-up questions for the spoken debrief. Only things NOT already answered in the transcript.
- Give at least three and at most five, the most valuable first: a missing limit or decision-maker is worth more than a missing reason, and both are worth more than a general question. "kind" is "reason" (why they did it), "guardrail" (the limit, the rule, who decides) or "exception" (a case that was not seen).
- One gap per thing that is unclear. Never two gaps of the same kind about the same action on the same case. Several queued questions about one action are one gap; give the questionId of the best one.
- Cover these kinds where they apply: an exception you noticed whose scope is unclear (does it hold for every case or only this one?); a rule whose limits or decision-maker nobody named (how much, until when, who decides or releases); a reason that was stated as a fact about one case but not as a rule; and a case that did not occur in this session but will come up, for example a kind of case or counterparty the expert has to treat differently.
- A queued question that the transcript does not answer should be covered by a gap, unless another gap already asks the same thing.
- "question" is what the apprentice will say out loud to the expert: second person, one or two short sentences, concrete about what was on screen. "why" is one sentence for the reader of the map.`;

export async function buildDraftWorkMap(sessionId: string): Promise<WorkMap> {
  const [session, events, allTranscript, questions, frames] = await Promise.all([
    sessions.get(sessionId),
    eventStore.all(sessionId),
    transcriptStore.all(sessionId),
    questionStore.all(sessionId),
    frameStore.all(sessionId),
  ]);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (events.length === 0) throw new Error(`Session ${sessionId} has no screen events, nothing to map`);

  // The draft is built from the task itself. Debrief talk is merged later by
  // finalizeWorkMap, so the gaps stay honest: not answered during the task.
  const transcript = allTranscript.filter((x) => x.phase === "capture").sort((a, b) => a.t - b.t);
  const sortedEvents = [...events].sort((a, b) => a.t - b.t);
  const captureIds = new Set(transcript.map((x) => x.id));
  const answeredDuringTask = (q: Question) =>
    q.status === "answered" && (q.answerTranscriptIds ?? []).some((id) => captureIds.has(id));
  const pending = questions.filter((q) => q.status !== "dropped" && !answeredDuringTask(q));

  const prompt = [
    `Expert: ${session.personName}`,
    `Task: ${session.task}`,
    "",
    "Screen events:",
    ...sortedEvents.slice(-400).map(eventLine),
    "",
    caseFieldGuide(sortedEvents),
    "",
    "Transcript during the task:",
    ...(transcript.length ? transcript.map(transcriptLine) : ["(nothing was said)"]),
    "",
    "Queued questions that were not answered during the task:",
    ...(pending.length ? pending.map((q) => `[${q.id} ${q.kind}] ${q.text} (about: ${q.eventIds.join(", ") || "no specific event"})`) : ["(none)"]),
  ].join("\n");

  const raw = await askModel<RawDraft>(DRAFT_SYSTEM, prompt);
  const map = assembleDraft(raw, { session, events: sortedEvents, transcript, frames, pending });
  await workMaps.set(sessionId, map);
  return map;
}

type DraftInput = {
  session: { id: string; task: string; personName: string };
  events: ScreenEvent[];
  transcript: TranscriptItem[];
  frames: Frame[];
  pending: Question[];
};

// Turns the model's proposal into a WorkMap that passes the hard rules.
// Exported so it can be tested without a model call.
export function assembleDraft(raw: RawDraft, input: DraftInput): WorkMap {
  const { session, events, transcript, frames, pending } = input;
  const eventIds = new Set(events.map((e) => e.id));
  // Checks may only use fact keys this session has. With no facts at all
  // (a session without the DOM channel and unreadable frames) none is kept.
  const fields = factKeysOf(events);
  const name = session.personName;

  // Gaps are collected with what they are about, so that two questions of
  // the same kind about the same step and case count as one.
  type Draft = Omit<Gap, "id"> & { kind: GapKind; subject: string; order: number };
  const collected: Draft[] = [];
  const seenGap = new Set<string>();
  const eventById = new Map(events.map((e) => [e.id, e]));
  const entityIds = [...new Set(events.map((e) => e.entity?.id).filter((x): x is string => !!x))];
  // The cases a gap is about: the ones its events belong to, else the ones
  // named in the question, else the ones of its step if the step has only one.
  const subjectOf = (question: string, stepId: string | undefined, ids: string[]) => {
    let cases = [...new Set(ids.map((id) => eventById.get(id)?.entity?.id).filter((x): x is string => !!x))];
    if (cases.length === 0) cases = entityIds.filter((id) => new RegExp(`(^|[^\\w])${id.replace(/[^\w-]/g, "")}([^\\w]|$)`).test(question));
    if (cases.length === 0 && stepId) {
      const step = steps.find((x) => x.id === stepId);
      const ofStep = [...new Set((step?.eventIds ?? []).map((id) => eventById.get(id)?.entity?.id).filter((x): x is string => !!x))];
      if (ofStep.length === 1) cases = ofStep;
    }
    if (cases.length === 0 && !stepId) return "";
    return `${stepId ?? ""}|${cases.sort().join(",")}`;
  };
  const addGap = (g: Omit<Gap, "id">, about: { kind?: GapKind; eventIds?: string[] } = {}) => {
    const text = normQ(g.question);
    if (!text || seenGap.has(text)) return false;
    const kind = about.kind ?? gapKind(g.question);
    const subject = subjectOf(g.question, g.stepId, about.eventIds ?? []);
    // Same kind of question about the same step and case: the first one stays.
    if (subject && kind !== "other" && collected.some((c) => c.kind === kind && c.subject === subject)) return false;
    seenGap.add(text);
    collected.push({ ...g, kind, subject, order: collected.length });
    return true;
  };

  // Steps. `rawIndex -> step` so guardrails and gaps can refer to model indices.
  const steps: WorkStep[] = [];
  const stepByRawIndex = new Map<number, WorkStep>();
  const demoted: Omit<Gap, "id">[] = [];
  (raw.steps ?? []).forEach((rs, i) => {
    const ids = (rs.eventIds ?? []).filter((id) => eventIds.has(id));
    const title = str(rs.title);
    if (!title) return;
    const moment =
      resolveMoment({ ...rs, eventIds: ids }, events, frames) ??
      // No frame was captured in this session at all. A routine step may stay
      // without a picture; the page shows a placeholder.
      (ids.length ? { t: events.find((e) => e.id === ids[ids.length - 1])!.t, frameId: "", label: str(rs.momentLabel) || title } : null);
    if (!moment) return; // no events, no frame: nothing on screen backs this step
    const reason = resolveQuote(rs.reason, transcript) ?? undefined;
    const step: WorkStep = {
      id: `s_${pad(steps.length + 1)}`,
      index: steps.length + 1,
      title,
      moment,
      decision: str(rs.decision) || title,
      ...(reason ? { reason } : {}),
      isJudgmentCall: !!rs.isJudgmentCall,
      guardrailIds: [],
      eventIds: ids,
    };
    // A judgment call needs the expert's words and a real screen moment.
    // Without them the action stays on the timeline as observed, and the
    // "why" goes to the debrief.
    if (step.isJudgmentCall && (!reason || !moment.frameId)) {
      step.isJudgmentCall = false;
      demoted.push({
        question: `At ${fmtT(moment.t)} you did this: ${step.decision}. What made you decide that?`,
        why: !reason
          ? `${JUDGMENT_GAP_PREFIX}, but ${name} did not say why during the task.`
          : `${JUDGMENT_GAP_PREFIX}, but no screen frame was captured for it.`,
        stepId: step.id,
        status: "open",
      });
    }
    steps.push(step);
    stepByRawIndex.set(i + 1, step);
  });

  // Guardrails.
  const guardrails: Guardrail[] = [];
  for (const rg of raw.guardrails ?? []) {
    const rule = str(rg.rule);
    if (!rule) continue;
    const step = stepByRawIndex.get(Number(rg.stepIndex)) ?? steps.find((s) => s.id === rg.stepId);
    const quote = resolveQuote(rg.quote, transcript);
    const moment =
      (rg.momentEventId && eventIds.has(rg.momentEventId) ? resolveMoment({ momentEventId: rg.momentEventId, momentLabel: rg.momentLabel }, events, frames) : null) ??
      (step?.moment.frameId ? step.moment : null);
    if (!step || !quote || !moment) {
      demoted.push({
        question: `I think there is a rule here: ${rule} Is that right, and when exactly does it apply?`,
        why: !quote
          ? `Inferred from what happened on screen. ${name} did not state it in words during the task.`
          : "A rule was stated, but it could not be tied to a moment on screen.",
        ...(step ? { stepId: step.id } : {}),
        status: "open",
      });
      continue;
    }
    const check = cleanCheck(rg.check, fields);
    const escalateTo = str(rg.escalateTo);
    const g: Guardrail = {
      id: `g_${pad(guardrails.length + 1)}`,
      stepId: step.id,
      type: cleanType(rg.type),
      rule,
      ...(escalateTo ? { escalateTo } : {}),
      ...(check ? { check } : {}),
      quote,
      moment,
    };
    guardrails.push(g);
    step.guardrailIds.push(g.id);
  }

  // Gaps: the model's, then anything demoted above, then queued questions the
  // model skipped, then generic ones if there are still fewer than three.
  const coveredQuestions = new Set<string>();
  for (const rg of raw.gaps ?? []) {
    const question = str(rg.question);
    if (!question) continue;
    const step = stepByRawIndex.get(Number(rg.stepIndex));
    if (rg.questionId) coveredQuestions.add(rg.questionId);
    const covered = pending.find((q) => q.id === rg.questionId);
    const kind = (["reason", "guardrail", "exception"] as const).find((k) => k === rg.kind) ?? covered?.kind;
    addGap(
      {
        question,
        why: str(rg.why) || "Not answered during the task.",
        ...(step ? { stepId: step.id } : {}),
        status: "open",
      },
      { kind, eventIds: covered?.eventIds },
    );
  }
  for (const g of demoted) addGap(g, g.why.startsWith(JUDGMENT_GAP_PREFIX) ? { kind: "reason" } : {});
  for (const q of pending) {
    if (coveredQuestions.has(q.id)) continue;
    const step = steps.find((s) => q.eventIds.some((id) => s.eventIds.includes(id)));
    addGap(
      {
        question: q.text,
        why: "Queued during the task and not answered before it ended.",
        ...(step ? { stepId: step.id } : {}),
        status: "open",
      },
      { kind: q.kind, eventIds: q.eventIds },
    );
  }
  const fallbacks: Omit<Gap, "id">[] = [
    {
      question: "What do you do when a case comes in that looks different from the ones you handled today, for example from someone you have never dealt with before?",
      why: "Only the cases in this session were seen. The unknown case was not.",
      status: "open",
    },
    {
      question: "When you are not sure about one of these, who do you ask, and at what point do you stop and ask?",
      why: "Nobody was named as the person who decides when the rules do not fit.",
      status: "open",
    },
    {
      question: "Is there anything you did today that you would do differently at another time of the month or year?",
      why: "The session covers one day, so seasonal or period-end exceptions were not seen.",
      status: "open",
    },
  ];
  for (const f of fallbacks) {
    if (collected.length >= 3) break;
    addGap(f);
  }
  // Most valuable first: a missing limit or decision-maker, then a missing
  // reason, then cases that were not seen. Within one kind the order in
  // which they were found stays. The debrief asks the first few only.
  const gaps: Omit<Gap, "id">[] = [...collected]
    .sort((a, b) => GAP_VALUE[b.kind] - GAP_VALUE[a.kind] || a.order - b.order)
    .slice(0, MAX_DEBRIEF_GAPS)
    .map((c) => ({
      question: c.question,
      why: c.why,
      ...(c.stepId ? { stepId: c.stepId } : {}),
      status: c.status,
    }));

  return {
    sessionId: session.id,
    task: session.task,
    expertName: session.personName,
    steps,
    guardrails,
    gaps: gaps.map((g, i) => ({ id: `gap_${pad(i + 1)}`, ...g })),
    status: "draft",
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- finalize

type RawFinal = {
  gaps?: { gapId?: string; status?: string; answer?: RawQuote }[];
  steps?: { stepId?: string; title?: string; decision?: string; isJudgmentCall?: boolean; reason?: RawQuote }[];
  guardrails?: { guardrailId?: string; remove?: boolean; type?: string; rule?: string; escalateTo?: string | null; check?: unknown; quote?: RawQuote }[];
  newGuardrails?: { stepId?: string; type?: string; rule?: string; escalateTo?: string | null; check?: unknown; quote?: RawQuote }[];
  teachBack?: { transcriptId?: string | null; confirmed?: boolean; corrections?: RawQuote[] } | null;
};

const FINAL_SYSTEM = `You are an apprentice finishing a Work Map after a spoken debrief with the expert. You receive the draft map (steps, guardrails, open gaps), the screen events and transcript of the task, and the transcript of the debrief. In the debrief the agent asked the open gaps, then explained the process back (the teach-back), and the expert confirmed or corrected it.

Return one JSON object with only what changes:
{
  "gaps": [
    { "gapId": "gap_01", "status": "answered" | "deferred" | "open", "answer": { "transcriptId": "tr id", "text": "exact words copied from that expert transcript item" } or null }
  ],
  "steps": [
    { "stepId": "s_03", "reason": { "transcriptId": "...", "text": "..." }, "decision": "...", "title": "...", "isJudgmentCall": true }
  ],
  "guardrails": [
    { "guardrailId": "g_02", "rule": "...", "type": "...", "escalateTo": "...", "check": {...}, "quote": { "transcriptId": "...", "text": "..." }, "remove": false }
  ],
  "newGuardrails": [
    { "stepId": "s_05", "type": "limit" | "exception" | "stop_and_ask" | "never", "rule": "...", "escalateTo": "..." or null, "check": {...} or null, "quote": { "transcriptId": "...", "text": "..." } }
  ],
  "teachBack": { "transcriptId": "id of the agent item that contains the teach-back", "confirmed": true or false, "corrections": [ { "transcriptId": "...", "text": "exact words of the expert's correction" } ] } or null
}

Rules:
- List every gap from the draft in "gaps". "answered" if the expert answered it in the debrief, with the answer quoted exactly. "deferred" if the expert said they do not know, or to skip it. "open" if it was never asked or not answered.
- Every "text" must be copied exactly from one transcript item spoken by the expert: the whole item or a contiguous part. Never paraphrase.
- steps: include a step only if the debrief changes it. Set "reason" when the debrief gives the reason for a step that had none, or states the general rule where the draft only had a remark about one case. Omit fields that do not change.
- guardrails: include an existing guardrail only if the debrief changes it: narrows or widens its scope, names who decides or who to escalate to, or corrects it. Then rewrite "rule" so it is correct and complete, update "escalateTo" and "check", and set "quote" to the debrief statement if that now states the rule better. If an existing guardrail has no check and the rule is now expressible, add one. Use "remove": true only if the expert said the rule is wrong.
- newGuardrails: rules the expert stated in the debrief that the draft does not have, including rules for cases that were not seen during the task. Attach each to the step where it would apply (for a rule about when not to proceed, the step where the case is moved on). Do not duplicate an existing guardrail; update it instead. A correction that only says something is NOT required (for example "that step is not about the price") is not a new guardrail: record it under teachBack.corrections and, if it sharpens an existing guardrail, update that one.
- teachBack: the agent's teach-back is the debrief item where it explains the whole process back. "confirmed" is true if the expert accepted it, also when they accepted it with a correction ("almost, ... the rest is right"). It is false if the expert rejected it, or has not answered yet. "corrections" are the expert's corrections to the teach-back, quoted exactly. If a correction contradicts a step or guardrail in the map, fix that step or guardrail above. If the teach-back claimed something that is not in the map and the expert rejected it, make sure no guardrail says it, and where the correction sharpens an existing guardrail (for example "however good it looks"), update that guardrail's rule. null if there was no teach-back.
${CHECK_GUIDE}`;

function recomputeStatus(map: WorkMap): WorkMap["status"] {
  return isDebriefDone(map) ? "confirmed" : "draft";
}

export async function finalizeWorkMap(sessionId: string): Promise<WorkMap> {
  const [draft, events, transcript, frames] = await Promise.all([
    workMaps.get(sessionId),
    eventStore.all(sessionId),
    transcriptStore.all(sessionId),
    frameStore.all(sessionId),
  ]);
  if (!draft) throw new Error(`Session ${sessionId} has no Work Map yet. Build the draft first.`);
  const sorted = [...transcript].sort((a, b) => a.t - b.t);
  const debrief = sorted.filter((x) => x.phase === "debrief");
  const capture = sorted.filter((x) => x.phase === "capture");

  if (debrief.length === 0) {
    const same = { ...draft, status: recomputeStatus(draft), updatedAt: new Date().toISOString() };
    await workMaps.set(sessionId, same);
    return same;
  }

  const prompt = [
    `Expert: ${draft.expertName}`,
    `Task: ${draft.task}`,
    "",
    "Draft map:",
    JSON.stringify(
      {
        steps: draft.steps.map((s) => ({ stepId: s.id, index: s.index, title: s.title, decision: s.decision, reason: s.reason?.text ?? null, isJudgmentCall: s.isJudgmentCall })),
        guardrails: draft.guardrails.map((g) => ({ guardrailId: g.id, stepId: g.stepId, type: g.type, rule: g.rule, escalateTo: g.escalateTo ?? null, check: g.check ?? null, quote: g.quote.text })),
        gaps: draft.gaps.map((g) => ({ gapId: g.id, question: g.question, stepId: g.stepId ?? null, status: g.status })),
      },
      null,
      1,
    ),
    "",
    "Screen events during the task:",
    ...[...events].sort((a, b) => a.t - b.t).slice(-400).map(eventLine),
    "",
    caseFieldGuide(events),
    "",
    "Transcript during the task:",
    ...(capture.length ? capture.map(transcriptLine) : ["(nothing was said)"]),
    "",
    "Debrief transcript:",
    ...debrief.map(transcriptLine),
  ].join("\n");

  const raw = await askModel<RawFinal>(FINAL_SYSTEM, prompt);

  // Re-read: the debrief tools may have patched the map while the model ran.
  const current = (await workMaps.get(sessionId)) ?? draft;
  const map = applyFinal(current, raw, { events, transcript: sorted, frames });
  await workMaps.set(sessionId, map);
  return map;
}

// Applies the model's proposed changes under the same hard rules as the draft.
// Exported so it can be tested without a model call.
export function applyFinal(
  current: WorkMap,
  raw: RawFinal,
  input: { events: ScreenEvent[]; transcript: TranscriptItem[]; frames: Frame[] },
): WorkMap {
  const { transcript } = input;
  const map: WorkMap = JSON.parse(JSON.stringify(current));
  const stepById = new Map(map.steps.map((s) => [s.id, s]));
  const quote = (r: RawQuote) => resolveQuote(r, transcript);
  const fields = factKeysOf(input.events);

  // Gaps: answers become quotes.
  for (const rg of raw.gaps ?? []) {
    const gap = map.gaps.find((g) => g.id === rg.gapId);
    if (!gap) continue;
    const answer = quote(rg.answer);
    if (rg.status === "answered" && answer) {
      gap.status = "answered";
      gap.answer = answer;
    } else if (rg.status === "deferred") {
      gap.status = "deferred";
      if (answer) gap.answer = answer;
    }
    // "answered" without a verifiable quote, or "open": keep what the debrief
    // tools recorded.
  }

  // Steps.
  for (const rs of raw.steps ?? []) {
    const step = stepById.get(rs.stepId ?? "");
    if (!step) continue;
    const reason = quote(rs.reason);
    if (reason) step.reason = reason;
    if (str(rs.title)) step.title = str(rs.title);
    if (str(rs.decision)) step.decision = str(rs.decision);
    if (typeof rs.isJudgmentCall === "boolean") step.isJudgmentCall = rs.isJudgmentCall;
  }
  // An answered gap about a step that still has no reason supplies it.
  for (const gap of map.gaps) {
    const step = stepById.get(gap.stepId ?? "");
    if (!step || gap.status !== "answered" || !gap.answer) continue;
    if (!step.reason) step.reason = gap.answer;
    // A judgment call that was demoted in the draft for lack of a reason.
    if (gap.why.startsWith(JUDGMENT_GAP_PREFIX)) step.isJudgmentCall = true;
  }
  // The rule from the draft holds here too.
  for (const step of map.steps) {
    if (step.isJudgmentCall && (!step.reason || !step.moment.frameId)) step.isJudgmentCall = false;
  }

  // Existing guardrails.
  for (const rg of raw.guardrails ?? []) {
    const g = map.guardrails.find((x) => x.id === rg.guardrailId);
    if (!g) continue;
    if (rg.remove === true) {
      map.guardrails = map.guardrails.filter((x) => x.id !== g.id);
      for (const s of map.steps) s.guardrailIds = s.guardrailIds.filter((id) => id !== g.id);
      continue;
    }
    if (str(rg.rule)) g.rule = str(rg.rule);
    if (rg.type) g.type = cleanType(rg.type);
    if (str(rg.escalateTo)) g.escalateTo = str(rg.escalateTo);
    if (rg.check !== undefined) {
      const check = cleanCheck(rg.check, fields);
      if (check) g.check = check;
      else if (rg.check === null) delete g.check;
    }
    const q = quote(rg.quote);
    if (q) g.quote = q;
  }

  // New guardrails from the debrief.
  let next = map.guardrails.reduce((m, g) => Math.max(m, Number(g.id.replace(/\D/g, "")) || 0), 0);
  // A rule for a case that was not seen goes where a case is normally moved
  // on: the step of the first committed action.
  const firstCommit = [...input.events].sort((a, b) => a.t - b.t).find((e) => e.kind === "action" && e.committed === true);
  const commitStep = map.steps.find((s) => !!firstCommit && s.eventIds.includes(firstCommit.id)) ?? map.steps[map.steps.length - 1];
  for (const rg of raw.newGuardrails ?? []) {
    const rule = str(rg.rule);
    const q = quote(rg.quote);
    const step = stepById.get(rg.stepId ?? "") ?? commitStep;
    // Same bar as the draft: no words from the expert or no screen moment, no guardrail.
    if (!rule || !q || !step || !step.moment.frameId) continue;
    if (map.guardrails.some((g) => g.quote.transcriptId === q.transcriptId && g.quote.text === q.text)) continue;
    const check = cleanCheck(rg.check, fields);
    const escalateTo = str(rg.escalateTo);
    const g: Guardrail = {
      id: `g_${pad(++next)}`,
      stepId: step.id,
      type: cleanType(rg.type),
      rule,
      ...(escalateTo ? { escalateTo } : {}),
      ...(check ? { check } : {}),
      quote: q,
      moment: step.moment,
    };
    map.guardrails.push(g);
    step.guardrailIds.push(g.id);
  }

  // Teach-back. The tools may already have recorded text and confirmation.
  const prior = map.teachBack;
  if (raw.teachBack || prior) {
    const said = transcript.find((x) => x.id === raw.teachBack?.transcriptId && x.speaker === "agent");
    const verified = (raw.teachBack?.corrections ?? []).map(quote).filter((q): q is Quote => !!q);
    // Corrections noted by the voice agent stay only if the transcript backs them.
    const kept = (prior?.corrections ?? []).filter((c) => c.transcriptId && isVerbatim(c, transcript));
    // One correction per overlapping passage: the longer wording wins.
    const corrections: Quote[] = [];
    for (const c of [...kept, ...verified].sort((a, b) => b.text.length - a.text.length)) {
      if (!corrections.some((x) => x.transcriptId === c.transcriptId && x.text.includes(c.text))) corrections.push(c);
    }
    corrections.sort((a, b) => a.t - b.t);
    const teachBack: TeachBack = {
      text: said?.text ?? prior?.text ?? "",
      confirmed: !!raw.teachBack?.confirmed || !!prior?.confirmed,
      corrections,
    };
    map.teachBack = teachBack;
  }

  // Last pass: nothing unverifiable survives.
  for (const s of map.steps) if (s.reason && !isVerbatim(s.reason, transcript)) delete s.reason;
  map.guardrails = map.guardrails.filter((g) => isVerbatim(g.quote, transcript));
  for (const s of map.steps) s.guardrailIds = map.guardrails.filter((g) => g.stepId === s.id).map((g) => g.id);
  for (const gap of map.gaps) if (gap.answer && !isVerbatim(gap.answer, transcript)) delete gap.answer;

  map.status = recomputeStatus(map);
  map.updatedAt = new Date().toISOString();
  return map;
}
