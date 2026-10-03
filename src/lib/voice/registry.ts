import type { ScribeStatus } from "@elevenlabs/react";
import type { Speaker } from "../types";

// The contract between <VoicePanel> and code that drives it (useInterviewer,
// the debrief page, the tutor page). A mounted panel registers its handle
// under its sessionId so hooks can find it without a ref being passed around.

export type VoiceStatus = "idle" | "connecting" | "connected" | "error";

export type VoiceState = {
  status: VoiceStatus;
  agentSpeaking: boolean;
  // Gated policy: true while the agent can hear the microphone. Always true
  // for the open policy and in text-only mode.
  micOpen: boolean;
  // Date.now() of the last moment the person was heard, or null.
  lastUserSpeechAt: number | null;
  lastAgentSpeechAt: number | null;
  // Scribe v2 Realtime connection, "off" when it is not used.
  scribe: ScribeStatus | "off";
  error?: string;
};

export type VoiceEvent =
  // A final utterance from either side. transcriptId is set once the
  // transcript route has stored it.
  | { type: "utterance"; speaker: Speaker; text: string; at: number; transcriptId?: string }
  | { type: "state"; state: VoiceState };

export type VoicePanelHandle = {
  start(): Promise<void>;
  stop(): Promise<void>;
  // Adds context without making the agent speak.
  sendContext(text: string): void;
  // Makes the agent say something now. The text is an instruction to the
  // agent, for example askInstruction(question) or "Guardrail: ...". With the
  // gated policy this also opens the microphone for the answer.
  speak(instruction: string): void;
  // Sends text as if the person had said it (text-only testing).
  sendText(text: string): void;
  // Gated policy only: let the agent hear the microphone, or stop it.
  openMic(): void;
  closeMic(): void;
  getState(): VoiceState;
  subscribe(listener: (event: VoiceEvent) => void): () => void;
  readonly status: VoiceStatus;
};

const handles = new Map<string, VoicePanelHandle>();
const waiters = new Set<() => void>();

export function registerVoice(sessionId: string, handle: VoicePanelHandle) {
  handles.set(sessionId, handle);
  waiters.forEach((w) => w());
  return () => {
    if (handles.get(sessionId) === handle) handles.delete(sessionId);
    waiters.forEach((w) => w());
  };
}

export const getVoice = (sessionId: string) => handles.get(sessionId) ?? null;

// Notifies when a panel registers or unregisters.
export function onVoiceRegistryChange(listener: () => void) {
  waiters.add(listener);
  return () => {
    waiters.delete(listener);
  };
}
