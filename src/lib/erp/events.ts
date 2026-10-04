// DOM event stream of the sandbox hiring desk (served at /hiring).
// The sandbox posts an ErpDomEvent on BroadcastChannel(ERP_CHANNEL) for every
// user step. Other tabs (capture, tutor) subscribe and treat it as ground truth.
// The sandbox listens on BroadcastChannel(ERP_CONTROL) for ErpControlMessage.
// The "erp" names are kept from the first version of the sandbox.

import type { CaseFacts, ScreenEvent } from "@/lib/types";
import { TRACKS, type Candidate } from "./seed";

export const ERP_CHANNEL = "erp-events";
export const ERP_CONTROL = "erp-control";

// source is always "dom". wallTime is Date.now() in the sandbox tab; the receiver
// converts it to session time `t` and assigns `id`.
export type ErpDomEvent = Omit<ScreenEvent, "id" | "t" | "frameId"> & { wallTime: number };

// "stop": the learner is about to do something the tutor wants to question;
// the sandbox delays the confirm button for a few seconds. "hint": no delay.
export type ErpCoachSeverity = "stop" | "hint";

export type ErpControlMessage =
  | { type: "highlight"; field: string }
  | { type: "open_candidate"; id: string }
  // Older name of open_candidate, still accepted.
  | { type: "open_invoice"; id: string }
  // Tutor banner shown in the sandbox tab. A new coach message replaces the one
  // on screen. `field` is highlighted for as long as the banner is shown.
  | { type: "coach"; text: string; field?: string; severity?: ErpCoachSeverity }
  | { type: "coach_clear" };

// Field names accepted by the "highlight" control message.
export const ERP_HIGHLIGHT_FIELDS = [
  "track",
  "interviewer",
  "university",
  "work_history",
  "referral",
  "current_employer",
  "advance",
  "hold",
  "escalate",
  "reject",
] as const;

// Facts of the application as currently shown on screen (unsaved edits included).
export function caseFacts(candidate: Candidate): CaseFacts {
  return {
    candidate_id: candidate.id,
    name: candidate.name,
    role: candidate.role,
    university: candidate.university,
    degree: candidate.degree,
    final_grade: candidate.finalGrade,
    years_experience: candidate.yearsExperience,
    has_production_ml: candidate.hasProductionMl,
    salary_expectation: candidate.salaryExpectation,
    referred_by_employee: candidate.referrer !== null,
    ...(candidate.referrer !== null ? { referrer: candidate.referrer } : {}),
    current_employer: candidate.currentEmployer,
    employer_is_partner: candidate.employerRelation !== null,
    track: candidate.draft.track,
    interviewer: candidate.draft.interviewer,
    status: candidate.status,
  };
}

// 125000 -> "CHF 125,000"
export function formatCHF(amount: number): string {
  return "CHF " + amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// Swiss grades with at least one decimal: 4 -> "4.0", 5.5 -> "5.5", 4.25 -> "4.25".
export function gradeLabel(grade: number): string {
  return Number.isInteger(grade * 10) ? grade.toFixed(1) : String(grade);
}

export function yearsLabel(n: number): string {
  return `${n} year${n === 1 ? "" : "s"}`;
}

// "standard" -> "Standard loop". Unknown values are returned unchanged.
export function trackLabel(value: string): string {
  return TRACKS.find((t) => t.value === value)?.short ?? value;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(ERP_CHANNEL);
  return channel;
}

export type ErpEventInput = Omit<ErpDomEvent, "wallTime" | "source" | "entity" | "facts">;

// Builds one event without posting it. When a candidate is given, entity and facts are filled from it.
export function buildErpEvent(input: ErpEventInput, candidate?: Candidate): ErpDomEvent {
  return {
    ...input,
    source: "dom",
    wallTime: Date.now(),
    ...(candidate ? { entity: { type: "candidate", id: candidate.id }, facts: caseFacts(candidate) } : {}),
  };
}

// Posts one event on the event channel.
export function emitErpEvent(input: ErpEventInput, candidate?: Candidate): ErpDomEvent {
  const event = buildErpEvent(input, candidate);
  getChannel()?.postMessage(event);
  return event;
}

// Summary builders. Wording follows fixtures/sessions/fixture_sabine/events.json.

export function queueOpenedSummary(candidates: Candidate[]): string {
  const open = candidates.filter((c) => c.status === "open").length;
  return `Application queue opened, ${open} open application${open === 1 ? "" : "s"}`;
}

export function candidateOpenedSummary(c: Candidate): string {
  const last = c.referrer ? `referred by ${c.referrer}` : c.role;
  return `Application ${c.id} opened (${c.name}, ${c.degree} ${c.university}, ${last})`;
}

export function workHistoryOpenedSummary(c: Candidate): string {
  if (c.hasProductionMl) {
    return `Work history of ${c.id} opened, ${yearsLabel(c.productionMlYears)} of production ML at ${c.productionMlAt} visible`;
  }
  if (c.yearsExperience === 0) return `Work history of ${c.id} opened, no work experience visible`;
  return `Work history of ${c.id} opened, ${yearsLabel(c.yearsExperience)} of experience and no production ML visible`;
}

// A doctorate is named with its field ("PhD in Machine Learning at UZH"), any
// other degree as in the queue ("BSc ETH Zurich"). The final grade is the
// candidate's, which belongs to the highest degree.
export function educationOpenedSummary(c: Candidate): string {
  const top = c.education[0];
  if (!top) return `Education of ${c.id} opened, no entries`;
  const degree = top.degree === "PhD" ? `${top.degree} in ${top.field} at ${top.university}` : `${top.degree} ${top.university}`;
  return `Education of ${c.id} opened, ${degree} with final grade ${gradeLabel(c.finalGrade)} visible`;
}

export function referralOpenedSummary(c: Candidate): string {
  if (!c.referrer) return `Referral of ${c.id} opened, no referral`;
  return `Referral of ${c.id} opened, referred by ${c.referrer} (employee) visible`;
}

const FIELD_LABELS: Record<string, string> = {
  track: "Track",
  interviewer: "Interviewer",
  note: "Note",
};

// before and after are the raw values ("standard", "fast"); the summary shows the labels.
export function fieldChangeSummary(field: string, before: string, after: string): string {
  const label = FIELD_LABELS[field] ?? field;
  const show = field === "track" ? trackLabel : (v: string) => v;
  if (before === "") return `${label} set to ${show(after)}`;
  if (after === "") return `${label} cleared (was ${show(before)})`;
  return `${label} changed from ${show(before)} to ${show(after)}`;
}

export type ErpAction = "advance" | "hold" | "escalate" | "reject" | "reopen";

// Actions that go through the confirmation box before anything is saved.
export type ErpConfirmAction = Exclude<ErpAction, "reopen">;

const REQUEST_NOUN: Record<ErpConfirmAction, string> = {
  advance: "Advance",
  hold: "Hold",
  escalate: "Escalation",
  reject: "Rejection",
};

// Summary of the uncommitted action event sent when the confirmation box opens.
export function actionRequestedSummary(action: ErpConfirmAction, c: Candidate): string {
  return `${REQUEST_NOUN[action]} of application ${c.id} requested, confirmation open`;
}

export function actionCancelledSummary(action: ErpConfirmAction, c: Candidate): string {
  return `${REQUEST_NOUN[action]} of application ${c.id} cancelled`;
}

export function actionSummary(action: ErpAction, c: Candidate): string {
  switch (action) {
    case "advance":
      return `Application ${c.id} advanced to interview`;
    case "hold":
      return `Application ${c.id} put on hold`;
    case "escalate":
      return `Application ${c.id} escalated to the founders`;
    case "reject":
      return `Application ${c.id} rejected`;
    case "reopen":
      return `Application ${c.id} reopened`;
  }
}
