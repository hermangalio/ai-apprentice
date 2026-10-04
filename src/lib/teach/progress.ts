import type { CaseFacts, Intervention, Prediction, Scorecard, ScreenEvent, WorkMap } from "../types";
import { caseIdOf, caseTypeOf, checkEvent } from "./check";

// Where the learner is in the process, and the end-of-session scorecard.
// Pure functions over the Work Map and the learner's events.

const byTime = (events: ScreenEvent[]) => [...events].sort((a, b) => a.t - b.t);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signature = (e: ScreenEvent) => `${e.kind}|${e.field ?? ""}|${e.action ?? ""}`;

// The step a learner event belongs to: the first step (in order) in which the
// expert produced an event of the same kind, field and action.
export function stepOfEvent(workMap: WorkMap, expertEvents: ScreenEvent[], e: ScreenEvent): string | undefined {
  const sig = signature(e);
  const expertById = new Map(expertEvents.map((x) => [x.id, x]));
  for (const s of [...workMap.steps].sort((a, b) => a.index - b.index)) {
    if (s.eventIds.some((id) => expertById.has(id) && signature(expertById.get(id)!) === sig)) return s.id;
  }
  return undefined;
}

export type StepProgress = {
  id: string;
  status: "done" | "current" | "upcoming";
  // The expert's reason may be shown: the learner acted, predicted, or was stopped here.
  revealed: boolean;
  // A guardrail of this step applies to the case and is not satisfied yet.
  atStake: boolean;
};

export type Progress = {
  caseId?: string;
  caseType: string; // "candidate", or "case" when the events do not say
  facts: CaseFacts;
  closed: boolean; // an action on the current case has been confirmed
  steps: StepProgress[];
  currentStepId?: string;
  atRiskIds: string[];
};

export function computeProgress(
  workMap: WorkMap,
  expertEvents: ScreenEvent[],
  learnerEvents: ScreenEvent[],
  interventions: (Intervention & { caseId?: string })[],
  predictions: Prediction[],
): Progress {
  const events = byTime(learnerEvents);
  const withCase = events.filter((e) => caseIdOf(e));
  const latest = withCase[withCase.length - 1];
  const caseId = latest ? caseIdOf(latest) : undefined;
  const mine = caseId ? events.filter((e) => caseIdOf(e) === caseId) : [];

  const done = new Set<string>();
  let closed = false;
  for (const e of mine) {
    if (e.kind === "action") {
      if (e.committed !== true) continue;
      closed = e.action !== "reopen";
    } else if (e.kind === "open") closed = false;
    const stepId = stepOfEvent(workMap, expertEvents, e);
    if (stepId) done.add(stepId);
  }

  const check = latest ? checkEvent(workMap, latest, events.filter((e) => e.t <= latest.t)) : null;
  const atRisk = closed || !check ? [] : check.atRisk;
  const intervened = new Set(
    interventions.filter((i) => !caseId || i.caseId === caseId).map((i) => i.guardrailId),
  );
  const predicted = new Set(predictions.map((p) => p.stepId));

  const ordered = [...workMap.steps].sort((a, b) => a.index - b.index);
  const atStake = (s: { guardrailIds: string[] }) => s.guardrailIds.some((g) => atRisk.some((r) => r.id === g));
  // A step whose guardrail is still unmet is not done, even if the learner touched its field.
  const isDone = (s: { id: string; guardrailIds: string[] }) => done.has(s.id) && !atStake(s);
  const lastDone = Math.max(0, ...ordered.filter(isDone).map((s) => s.index));
  // After an intervention the step to work on is the one the tutor stopped at.
  const stopped = ordered.find((s) => atStake(s) && s.guardrailIds.some((g) => intervened.has(g)));
  const current = closed ? undefined : (stopped ?? ordered.find((s) => s.index > lastDone && !isDone(s)));

  const steps: StepProgress[] = ordered.map((s) => ({
    id: s.id,
    status: isDone(s) ? "done" : current?.id === s.id ? "current" : "upcoming",
    revealed: isDone(s) || predicted.has(s.id) || s.guardrailIds.some((g) => intervened.has(g)),
    atStake: atStake(s),
  }));

  return {
    caseId,
    caseType: check?.caseType ?? (latest ? caseTypeOf(latest) : "case"),
    facts: check?.facts ?? {},
    closed,
    steps,
    currentStepId: current?.id,
    atRiskIds: atRisk.map((g) => g.id),
  };
}

export type ScoreItem = {
  id: string; // guardrail or step id
  kind: "guardrail" | "step";
  label: string;
  status: "mastered" | "practice" | "not_seen";
  note: string;
  quote?: string;
};

type Situation = { caseId: string; label: string; result: "open" | "clean" | "broken"; intervened: boolean };

export function computeScorecard<I extends Intervention & { caseId?: string; severity?: string }>(
  workMap: WorkMap,
  learnerEvents: ScreenEvent[],
  interventions: I[],
  predictions: Prediction[],
  sessionId: string,
): { scorecard: Scorecard; items: ScoreItem[]; interventions: I[] } {
  const events = byTime(learnerEvents);
  const eventCase = new Map(events.map((e) => [e.id, caseIdOf(e)]));
  const caseOf = (i: I) => i.caseId ?? eventCase.get(i.learnerEventId);

  // Every (guardrail, case) pair in which the guardrail applied.
  const situations = new Map<string, Situation[]>();
  events.forEach((e, idx) => {
    const res = checkEvent(workMap, e, events.slice(0, idx));
    if (res.skipped || !res.caseId) return;
    const touch = (gid: string) => {
      const list = situations.get(gid) ?? [];
      if (!situations.has(gid)) situations.set(gid, list);
      let s = list.find((x) => x.caseId === res.caseId);
      if (!s) list.push((s = { caseId: res.caseId!, label: `${res.caseType} ${res.caseId}`, result: "open", intervened: false }));
      return s;
    };
    const closing = e.kind === "action" && e.committed === true && e.action !== "reopen";
    for (const g of res.atRisk) touch(g.id);
    for (const g of res.satisfied) {
      const s = touch(g.id);
      if (closing && s.result !== "broken") s.result = "clean";
    }
    for (const v of res.violations) {
      const s = touch(v.guardrail.id);
      if (closing) s.result = "broken";
    }
  });
  for (const i of interventions) {
    const s = situations.get(i.guardrailId)?.find((x) => x.caseId === caseOf(i));
    if (s && i.severity !== "broken") s.intervened = true;
  }

  // Fill in outcomes the voice agent did not log.
  const resolved = interventions.map((i) => {
    if (i.outcome) return i;
    const s = situations.get(i.guardrailId)?.find((x) => x.caseId === caseOf(i));
    if (s?.result === "broken") return { ...i, outcome: "overridden" as const };
    if (s?.result === "clean") return { ...i, outcome: "corrected" as const };
    return i;
  });

  const items: ScoreItem[] = [];
  const who = workMap.expertName;
  for (const g of workMap.guardrails) {
    const list = situations.get(g.id) ?? [];
    const closedOnes = list.filter((s) => s.result !== "open");
    const last = closedOnes[closedOnes.length - 1];
    const logged = resolved.filter((i) => i.guardrailId === g.id);
    let status: ScoreItem["status"] = "not_seen";
    let note = "Did not come up in this session.";
    if (last?.result === "broken") {
      status = "practice";
      note = `${cap(last.label)} was confirmed against this rule.`;
    } else if (last?.result === "clean" && last.intervened) {
      status = "practice";
      note = `Caught before confirming on ${last.label}, then corrected. Not yet done without help.`;
    } else if (last?.result === "clean") {
      status = "mastered";
      note = `Handled on ${last.label} without help.`;
    } else if (logged.length > 0) {
      status = "practice";
      const o = logged[logged.length - 1].outcome;
      note = o === "corrected" ? "Corrected after the tutor stepped in." : o === "overridden" ? "Went ahead against the rule." : "The tutor stepped in; the case is still open.";
    } else if (list.length > 0) {
      note = `Came up on ${list[list.length - 1].label}; the case is still open.`;
    }
    items.push({ id: g.id, kind: "guardrail", label: g.rule, status, note, quote: `${who}: "${g.quote.text}"` });
  }

  const practiceGuardrailSteps = new Set(
    workMap.guardrails.filter((g) => items.find((i) => i.id === g.id)?.status === "practice").map((g) => g.stepId),
  );
  for (const s of workMap.steps) {
    const answered = predictions.filter((p) => p.stepId === s.id && p.correct !== undefined);
    const last = answered[answered.length - 1];
    if (!last) continue;
    const ok = last.correct === true && !practiceGuardrailSteps.has(s.id);
    items.push({
      id: s.id,
      kind: "step",
      label: s.title,
      status: ok ? "mastered" : "practice",
      note: last.correct
        ? ok
          ? `Predicted ${who}'s decision correctly.`
          : `Predicted ${who}'s decision, but the rule was not applied without help.`
        : `Did not predict ${who}'s decision: ${s.decision}.`,
      quote: s.reason ? `${who}: "${s.reason.text}"` : undefined,
    });
  }

  const scorecard: Scorecard = {
    sessionId,
    mastered: items.filter((i) => i.status === "mastered").map((i) => i.id),
    practiceNext: items.filter((i) => i.status === "practice").map((i) => i.id),
    interventions: resolved,
    predictions,
  };
  return { scorecard, items, interventions: resolved };
}
