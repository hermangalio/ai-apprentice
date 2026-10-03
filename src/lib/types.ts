// Shared contracts. Every module reads and writes these shapes; change them
// only together with src/lib/store.ts and fixtures/.

// All `t` values are milliseconds since the session started.

export type SessionRole = "expert" | "learner";

export type Session = {
  id: string;
  role: SessionRole;
  personName: string; // "Sabine", "Lena"
  task: string; // "Process supplier invoices"
  startedAt: string; // ISO
  endedAt?: string;
  // Learner sessions point at the expert session whose Work Map is being taught.
  workMapSessionId?: string;
};

export type ScreenEventKind = "open" | "navigate" | "field_change" | "action" | "other";

// The facts of the case on screen that guardrail checks are evaluated against.
// The sandbox ERP sends them with every DOM event; for other apps the vision
// model fills in what it can read.
export type CaseFacts = {
  invoice_id?: string;
  supplier?: string;
  supplier_known?: boolean;
  supplier_is_group_company?: boolean;
  amount?: number; // EUR
  category?: string; // "equipment", "consumables", "services", ...
  invoice_month?: number; // 1-12
  cost_center?: string;
  asset_number?: string;
  status?: string; // "open", "posted", "on_hold", "awaiting_approval"
};

export type ScreenEvent = {
  id: string;
  t: number;
  kind: ScreenEventKind;
  // Short, concrete, past tense: "Cost center changed from 4711 to 0400".
  summary: string;
  // What the event is about, when identifiable: { type: "invoice", id: "4471" }.
  entity?: { type: string; id: string };
  field?: string; // "cost_center"
  before?: string;
  after?: string;
  // "save", "hold", "send_for_approval", ... for kind === "action".
  action?: string;
  // True once the change is persisted. An unsaved field_change is the window
  // in which the tutor can still step in.
  committed?: boolean;
  facts?: CaseFacts;
  frameId?: string;
  // "vision" is the general path. "dom" comes from the sandbox ERP over a
  // BroadcastChannel and is used as ground truth and as a low-latency signal.
  source: "vision" | "dom";
};

export type Frame = { id: string; t: number; file: string }; // file relative to the session dir

export type Speaker = "expert" | "learner" | "agent";
export type Phase = "capture" | "debrief" | "teach";

export type TranscriptItem = {
  id: string;
  t: number;
  speaker: Speaker;
  text: string; // PII-redacted before it is stored
  phase: Phase;
};

export type QuestionKind = "reason" | "guardrail" | "exception";

export type Question = {
  id: string;
  kind: QuestionKind;
  text: string;
  eventIds: string[]; // the on-screen moments it is about
  // queued: waiting for a pause or for the debrief. asked: spoken. answered: expert replied.
  status: "queued" | "asked" | "answered" | "dropped";
  askedAt?: number;
  askedIn?: Phase;
  answerTranscriptIds?: string[];
};

export type Quote = {
  text: string; // the expert's own words
  transcriptId: string;
  t: number;
  source: "live" | "debrief";
};

export type ScreenMoment = { t: number; frameId: string; label: string }; // "03:12, invoice 4471, cost center field"

// A machine-checkable form of a guardrail, when one can be derived. The tutor
// evaluates it against the learner's case; `rule` stays the source of truth.
export type GuardrailCheck = {
  when: string; // condition on the case, e.g. "category == 'equipment' && amount > 5000"
  require?: string; // e.g. "cost_center == '0400'"
  forbid?: string; // e.g. "action == 'save' && !asset_number"
};

export type Guardrail = {
  id: string;
  stepId: string;
  type: "limit" | "exception" | "stop_and_ask" | "never";
  rule: string; // "No asset number, no capex booking."
  escalateTo?: string; // "the controller"
  check?: GuardrailCheck;
  quote: Quote;
  moment: ScreenMoment;
};

export type WorkStep = {
  id: string;
  index: number; // 1-based
  title: string; // "Code the invoice to a cost center"
  moment: ScreenMoment;
  decision: string; // "Re-coded from opex (4711) to capex (0400)"
  reason?: Quote;
  isJudgmentCall: boolean;
  guardrailIds: string[];
  eventIds: string[];
};

export type Gap = {
  id: string;
  question: string;
  why: string; // what is unclear and why it matters
  stepId?: string;
  status: "open" | "answered" | "deferred";
  answer?: Quote;
};

export type TeachBack = {
  text: string;
  confirmed: boolean;
  corrections: Quote[];
};

export type WorkMap = {
  sessionId: string;
  task: string;
  expertName: string;
  steps: WorkStep[];
  guardrails: Guardrail[];
  gaps: Gap[];
  teachBack?: TeachBack;
  // "draft": built from the capture session, gaps open. "confirmed": debrief
  // closed the gaps and the expert accepted the teach-back.
  status: "draft" | "confirmed";
  updatedAt: string;
};

// Teach

export type Intervention = {
  id: string;
  t: number;
  guardrailId: string;
  learnerEventId: string;
  message: string; // what the tutor says, using the expert's reasoning
  outcome?: "corrected" | "overridden";
};

export type Prediction = {
  id: string;
  t: number;
  stepId: string;
  prompt: string; // "What would you do with this one?"
  learnerAnswer?: string;
  correct?: boolean;
};

export type Scorecard = {
  sessionId: string;
  mastered: string[]; // step or guardrail ids
  practiceNext: string[];
  interventions: Intervention[];
  predictions: Prediction[];
};
