import * as store from "../store";
import type { Guardrail, ScreenEvent, Session, WorkMap } from "../types";
import { checkEvent, guardrailField, invoiceIdOf, type Severity, type Violation } from "./check";
import { checkWithModel } from "./checkModel";
import {
  interventionInstruction,
  interventionMessage,
  interventionQuestion,
  predictionInstruction,
  predictionPrompt,
} from "./instructions";
import { mutateTeachState, type TeachIntervention } from "./state";

// Server-only. One call per learner event: check it, persist interventions,
// and return what the tutor should say.

export type CheckedViolation = {
  guardrailId: string;
  stepId: string;
  severity: Severity;
  explanation: string;
  question: string;
  quote: string;
  rule: string;
  instruction: string;
  field?: string;
  interventionId: string;
  // True when this intervention was already issued (same event, or the same
  // guardrail on the same invoice a moment ago). Do not speak it again.
  repeat: boolean;
};

export type PredictionCue = {
  stepId: string;
  guardrailId: string;
  prompt: string;
  // Shown after the learner has answered.
  rule: string;
  quote: string;
  instruction: string;
  repeat: boolean;
};

export type CheckResponse = {
  eventId: string;
  invoiceId?: string;
  violations: CheckedViolation[];
  atRisk: { id: string; stepId: string; rule: string }[];
  prediction?: PredictionCue;
  // Ids of guardrails this response could not decide: no usable `check` and
  // the model was not asked (or did not answer). The caller may ask again
  // with useModel true; violations already issued come back as repeats.
  undecided: string[];
  decidedBy: "rule" | "model";
  skipped?: string;
  ms: number;
};

// Two interventions for the same guardrail on the same invoice within this
// window count as one (a live broadcast event and its stored copy, or a field
// change followed at once by a save attempt).
const REPEAT_WINDOW_MS = 5000;

export async function loadTeachContext(
  learnerSessionId: string,
): Promise<{ session: Session; workMap: WorkMap } | { error: string; status: number }> {
  const session = await store.sessions.get(learnerSessionId);
  if (!session) return { error: "Learner session not found", status: 404 };
  if (!session.workMapSessionId) return { error: "Session has no workMapSessionId", status: 400 };
  const workMap = await store.workMaps.get(session.workMapSessionId);
  if (!workMap) return { error: `No Work Map for session ${session.workMapSessionId}`, status: 404 };
  return { session, workMap };
}

export async function runCheck(
  session: Session,
  workMap: WorkMap,
  event: ScreenEvent,
  opts: { useModel?: boolean } = {},
): Promise<CheckResponse> {
  const started = performance.now();
  const all = await store.events.all(session.id);
  const history = all.filter((e) => e.id !== event.id && e.t <= event.t).sort((a, b) => a.t - b.t);

  const result = checkEvent(workMap, event, history);
  let violations: Violation[] = result.violations;
  let atRisk: Guardrail[] = result.atRisk;
  let satisfied: Guardrail[] = result.satisfied;
  let decidedBy: "rule" | "model" = "rule";
  let undecided: Guardrail[] = result.skipped ? [] : result.undecided;

  // Typing pings and queue views carry nothing to judge.
  const worthAsking = event.kind !== "other" || Boolean(event.action);
  if (!result.skipped && result.undecided.length > 0 && opts.useModel !== false && worthAsking) {
    try {
      const extra = await checkWithModel(workMap, event, history, result.undecided);
      if (extra.violations.length || extra.atRisk.length) decidedBy = "model";
      violations = [...violations, ...extra.violations];
      atRisk = [...atRisk, ...extra.atRisk];
      satisfied = [...satisfied, ...extra.satisfied];
      undecided = [];
    } catch {
      // The model is a fallback; without it the deterministic result stands.
    }
  }

  const invoiceId = result.invoiceId;
  const ruleIds = new Set(result.violations.map((v) => v.guardrail.id));
  const closing = event.kind === "action" && event.committed === true;

  const out = await mutateTeachState(session.id, (state) => {
    const checked: CheckedViolation[] = violations.map((v) => {
      const g = v.guardrail;
      const prior = state.interventions.find(
        (i) =>
          i.guardrailId === g.id &&
          (i.learnerEventId === event.id ||
            (i.invoiceId === invoiceId && i.severity === v.severity && Math.abs(i.t - event.t) < REPEAT_WINDOW_MS)),
      );
      const question = interventionQuestion(workMap, v.severity);
      const instruction = interventionInstruction(workMap, g, event, result.facts, v.severity);
      const field = guardrailField(g);
      let record: TeachIntervention | undefined = prior;
      if (!record) {
        record = {
          id: store.newId("int"),
          t: event.t,
          guardrailId: g.id,
          learnerEventId: event.id,
          message: interventionMessage(workMap, g, v.severity),
          invoiceId,
          severity: v.severity,
          question,
          quote: g.quote.text,
          explanation: v.explanation,
          instruction,
          field,
          decidedBy: ruleIds.has(g.id) ? "rule" : "model",
          ...(v.severity === "broken" ? { outcome: "overridden" as const } : {}),
        } satisfies TeachIntervention;
        state.interventions.push(record);
      }
      return {
        guardrailId: g.id,
        stepId: g.stepId,
        severity: v.severity,
        explanation: v.explanation,
        question,
        quote: g.quote.text,
        rule: g.rule,
        instruction,
        field,
        interventionId: record.id,
        repeat: Boolean(prior),
      };
    });

    // A committed action settles earlier interventions on this invoice.
    if (closing && invoiceId) {
      const broken = new Set(violations.map((v) => v.guardrail.id));
      const ok = new Set(satisfied.map((g) => g.id));
      for (const i of state.interventions) {
        if (i.invoiceId !== invoiceId || i.outcome) continue;
        if (broken.has(i.guardrailId)) i.outcome = "overridden";
        else if (ok.has(i.guardrailId)) i.outcome = "corrected";
      }
    }

    // On opening a case with a guardrail at stake, ask for a prediction
    // instead of interrupting.
    let prediction: PredictionCue | undefined;
    if (event.kind === "open" && invoiceId && violations.length === 0 && atRisk.length > 0) {
      const steps = [...workMap.steps].sort((a, b) => a.index - b.index);
      const stake = steps.filter((s) => atRisk.some((g) => g.stepId === s.id));
      const step = stake.find((s) => s.isJudgmentCall) ?? stake[0];
      const g = step && atRisk.find((x) => x.stepId === step.id);
      if (step && g) {
        const key = `${invoiceId}:${step.id}`;
        const repeat = state.cued.includes(key);
        if (!repeat) state.cued.push(key);
        prediction = {
          stepId: step.id,
          guardrailId: g.id,
          prompt: predictionPrompt(workMap),
          rule: g.rule,
          quote: g.quote.text,
          instruction: predictionInstruction(workMap, step, g, result.facts),
          repeat,
        };
      }
    }
    return { checked, prediction };
  });

  return {
    eventId: event.id,
    invoiceId: invoiceId ?? invoiceIdOf(event),
    violations: out.checked,
    atRisk: atRisk.map((g) => ({ id: g.id, stepId: g.stepId, rule: g.rule })),
    prediction: out.prediction,
    undecided: undecided.map((g) => g.id),
    decidedBy,
    skipped: result.skipped,
    ms: Math.round((performance.now() - started) * 10) / 10,
  };
}
