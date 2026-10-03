// Pause detection for the live interviewer. Pure: no timers, no browser APIs.
// All times are milliseconds on one clock (session time or Date.now(), as long
// as every field uses the same one).
//
// The rule from the brief: stay quiet while the expert types, reads or talks;
// ask at natural pauses; three to five live questions per ten minutes; the
// rest waits for the debrief.

// The screen has not changed for this long. Covers reading: after a page
// opens or a field changes the expert is still looking at it.
export const SCREEN_QUIET_MS = 3000;
// No key was pressed for this long.
export const TYPING_QUIET_MS = 3000;
// The expert has not spoken for this long.
export const SPEECH_QUIET_MS = 2000;
// The agent itself finished speaking at least this long ago.
export const AGENT_QUIET_MS = 1500;
// Minimum time between two live questions.
export const MIN_QUESTION_GAP_MS = 40_000;
// Live question budget: at most this many in any rolling window.
export const MAX_QUESTIONS_PER_WINDOW = 5;
export const QUESTION_WINDOW_MS = 10 * 60_000;
// No question in the first seconds of a session.
export const WARMUP_MS = 15_000;
// A question is about something visible on screen, so the event it refers to
// must be recent. Older ones wait for the debrief.
export const MAX_EVENT_AGE_MS = 90_000;

// After a question: the answer counts as finished when the expert has spoken
// and then been quiet for this long.
export const ANSWER_QUIET_MS = 2500;
// If the expert says nothing at all, the question window closes after this.
export const ANSWER_TIMEOUT_MS = 20_000;
// Upper bound for one question window, follow-up included.
export const ANSWER_MAX_MS = 75_000;

export type PauseInput = {
  now: number;
  // Start of the session on the same clock (0 when `now` is session time).
  sessionStartedAt?: number;
  // Last change on screen: a screen event, a DOM event, a frame that differed.
  lastScreenActivityAt?: number | null;
  lastTypingAt?: number | null;
  // Last moment the expert was heard speaking (partial transcripts count).
  lastUserSpeechAt?: number | null;
  agentSpeaking: boolean;
  lastAgentSpeechAt?: number | null;
  // A question was asked and its window is still open.
  awaitingAnswer?: boolean;
  // Times at which live questions were asked so far.
  questionTimes?: number[];
};

export type PauseBlock =
  | "warmup"
  | "agent_speaking"
  | "awaiting_answer"
  | "talking"
  | "typing"
  | "reading"
  | "min_gap"
  | "budget";

export type PauseDecision = {
  // True when a question may be asked right now.
  open: boolean;
  // Everything that currently keeps the window closed. Empty when open.
  blockedBy: PauseBlock[];
  // Earliest time at which the window could open if nothing else happens.
  // Equal to `now` when open.
  opensAt: number;
};

const since = (now: number, t: number | null | undefined) => (t == null ? Infinity : now - t);

export function evaluatePause(input: PauseInput): PauseDecision {
  const { now } = input;
  const blockedBy: PauseBlock[] = [];
  let opensAt = now;
  const block = (reason: PauseBlock, until: number) => {
    blockedBy.push(reason);
    opensAt = Math.max(opensAt, until);
  };

  const startedAt = input.sessionStartedAt ?? 0;
  if (now - startedAt < WARMUP_MS) block("warmup", startedAt + WARMUP_MS);

  if (input.agentSpeaking) block("agent_speaking", now + AGENT_QUIET_MS);
  else if (since(now, input.lastAgentSpeechAt) < AGENT_QUIET_MS) {
    block("agent_speaking", input.lastAgentSpeechAt! + AGENT_QUIET_MS);
  }

  if (input.awaitingAnswer) block("awaiting_answer", now + ANSWER_QUIET_MS);

  if (since(now, input.lastUserSpeechAt) < SPEECH_QUIET_MS) block("talking", input.lastUserSpeechAt! + SPEECH_QUIET_MS);
  if (since(now, input.lastTypingAt) < TYPING_QUIET_MS) block("typing", input.lastTypingAt! + TYPING_QUIET_MS);
  if (since(now, input.lastScreenActivityAt) < SCREEN_QUIET_MS) {
    block("reading", input.lastScreenActivityAt! + SCREEN_QUIET_MS);
  }

  const asked = (input.questionTimes ?? []).filter((t) => t <= now).sort((a, b) => a - b);
  const last = asked[asked.length - 1];
  if (last !== undefined && now - last < MIN_QUESTION_GAP_MS) block("min_gap", last + MIN_QUESTION_GAP_MS);

  const recent = asked.filter((t) => now - t < QUESTION_WINDOW_MS);
  if (recent.length >= MAX_QUESTIONS_PER_WINDOW) {
    // Opens again when the oldest question that counts falls out of the window.
    block("budget", recent[recent.length - MAX_QUESTIONS_PER_WINDOW] + QUESTION_WINDOW_MS);
  }

  return { open: blockedBy.length === 0, blockedBy, opensAt };
}

export type AnswerInput = {
  now: number;
  askedAt: number;
  lastUserSpeechAt?: number | null;
  agentSpeaking: boolean;
  lastAgentSpeechAt?: number | null;
};

export type AnswerState = "waiting" | "answering" | "answered" | "unanswered";

// Tracks the window after a question. "answered": the expert spoke after the
// question and has gone quiet. "unanswered": nobody spoke before the timeout.
export function evaluateAnswer(input: AnswerInput): AnswerState {
  const { now, askedAt } = input;
  if (now - askedAt > ANSWER_MAX_MS) {
    return (input.lastUserSpeechAt ?? -Infinity) > askedAt ? "answered" : "unanswered";
  }
  // The agent is still asking, or asking its one follow-up.
  if (input.agentSpeaking) return "waiting";
  const spoke = (input.lastUserSpeechAt ?? -Infinity) > askedAt;
  if (!spoke) {
    const ref = Math.max(askedAt, input.lastAgentSpeechAt ?? askedAt);
    return now - ref > ANSWER_TIMEOUT_MS ? "unanswered" : "waiting";
  }
  const quietSince = Math.max(input.lastUserSpeechAt!, input.lastAgentSpeechAt ?? -Infinity);
  return now - quietSince >= ANSWER_QUIET_MS ? "answered" : "answering";
}
