import { redact } from "../capture/redact";
import type { Phase, ScreenEvent, Speaker } from "../types";

// Shared by the voice client code. The agent prompts (scripts/setup-agents.mts)
// use the same conventions.

export type VoiceMode = "interviewer" | "debrief" | "tutor";

// Prefix of messages that come from the app instead of the person.
export const APP_PREFIX = "[[APP]]";

export const PHASE_OF: Record<VoiceMode, Phase> = {
  interviewer: "capture",
  debrief: "debrief",
  tutor: "teach",
};

export const HUMAN_SPEAKER_OF: Record<VoiceMode, Speaker> = {
  interviewer: "expert",
  debrief: "expert",
  tutor: "learner",
};

export const askInstruction = (question: string) => `${APP_PREFIX} Ask: ${question}`;
export const appInstruction = (instruction: string) =>
  instruction.startsWith(APP_PREFIX) ? instruction : `${APP_PREFIX} ${instruction}`;

// Context lines for the agent. Emails, phone numbers, IBANs and card numbers
// are masked before the text leaves the browser.
export const screenUpdate = (e: Pick<ScreenEvent, "summary">) => `Screen: ${redact(e.summary)}`;
export const heardUpdate = (text: string) => `Heard: ${redact(text)}`;

// Expressive Mode lets the model put delivery tags such as [curious] in its
// text. They are not part of what was said.
export function cleanAgentText(text: string) {
  return text
    .replace(/\[[a-z][a-z ,'-]{1,30}\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The platform reports "..." for a turn in which nothing was said.
export function isEmptyUtterance(text: string) {
  return text.replace(/[\s.…]/g, "") === "";
}
