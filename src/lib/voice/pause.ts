// Pause detection for the live interviewer. Pure: no timers, no browser APIs.
// All times are milliseconds on one clock (session time or Date.now(), as long
// as every field uses the same one).
//
// The rule from the brief: stay quiet while the expert types, reads or talks;
// ask at natural pauses (the screen and the expert are quiet, or an action
// was just committed and the expert has stopped talking); three to five live questions per ten minutes; the
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
// A committed action (post, hold, send for approval confirmed) is a natural
// boundary: the decision is made and the next case has not started. For a
// short time after it the screen does not have to be still (it changes
// because of the commit) and a shorter silence is enough. Speech quiet is
// still required, so nobody is interrupted mid-sentence.
export const COMMIT_SETTLE_MS = 700;
export const COMMIT_WINDOW_MS = 12_000;
export const COMMIT_SPEECH_QUIET_MS = 1200;
// Minimum time between two live questions. Counted from the moment the
// question was spoken, so the answer takes up part of it.
export const MIN_QUESTION_GAP_MS = 20_000;
// From the fourth question in the rolling window on, the gap is longer, so
// the budget is not used up in the first two minutes of a long session.
export const LATER_QUESTION_GAP_MS = 60_000;
export const SHORT_GAP_QUESTIONS = 3;
// Live question budget: at most this many in any rolling window.
export const MAX_QUESTIONS_PER_WINDOW = 5;
export const QUESTION_WINDOW_MS = 10 * 60_000;
// No question in the first seconds of a session.
export const WARMUP_MS = 8_000;
// A question is about something visible on screen, so the event it refers to
// must be recent. Older ones wait for the debrief.
export const MAX_EVENT_AGE_MS = 90_000;

// After a question: the answer counts as finished when the expert has spoken
// and then been quiet for this long.
export const ANSWER_QUIET_MS = 4000;
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
  // Last committed action seen on screen (post, hold, send for approval).
  lastCommitAt?: number | null;
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

// The gap that applies after `askedInWindow` questions in the rolling window.
export const minGapAfter = (askedInWindow: number) =>
  askedInWindow >= SHORT_GAP_QUESTIONS ? LATER_QUESTION_GAP_MS : MIN_QUESTION_GAP_MS;

// True for the short time after a committed action in which a question may
// be asked without waiting for the screen to go still.
export function atCommitBoundary(now: number, lastCommitAt: number | null | undefined) {
  const age = since(now, lastCommitAt);
  return age >= COMMIT_SETTLE_MS && age <= COMMIT_WINDOW_MS;
}

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

  const boundary = atCommitBoundary(now, input.lastCommitAt);
  const speechQuiet = boundary ? COMMIT_SPEECH_QUIET_MS : SPEECH_QUIET_MS;
  if (since(now, input.lastUserSpeechAt) < speechQuiet) block("talking", input.lastUserSpeechAt! + speechQuiet);
  if (since(now, input.lastTypingAt) < TYPING_QUIET_MS) block("typing", input.lastTypingAt! + TYPING_QUIET_MS);
  if (!boundary && since(now, input.lastScreenActivityAt) < SCREEN_QUIET_MS) {
    block("reading", input.lastScreenActivityAt! + SCREEN_QUIET_MS);
  }

  const asked = (input.questionTimes ?? []).filter((t) => t <= now).sort((a, b) => a - b);
  const last = asked[asked.length - 1];
  const recent = asked.filter((t) => now - t < QUESTION_WINDOW_MS);
  const gap = minGapAfter(recent.length);
  if (last !== undefined && now - last < gap) block("min_gap", last + gap);

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
