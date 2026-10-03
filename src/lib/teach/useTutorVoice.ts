"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ScreenEvent } from "../types";
import { screenUpdate } from "../voice/protocol";
import { getVoice, onVoiceRegistryChange } from "../voice/registry";
import { createPendingSpeech, type SpeechCue } from "./cues";

// Connects the tutor panel to the voice panel registered under the same
// session id. VoicePanel.speak() does nothing while the voice is not
// connected, so the latest instruction is kept here and spoken once the
// voice connects, unless it has gone stale by then.

// The voice panel sends its own opening message 400 ms after connecting. A
// kept instruction goes out after that.
const SPEAK_AFTER_CONNECT_MS = 1500;

export function useTutorVoice(sessionId: string) {
  const pending = useRef(createPendingSpeech());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connected = useCallback(() => getVoice(sessionId)?.getState().status === "connected", [sessionId]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const flushSoon = () => {
      if (!connected() || !pending.current.waiting || timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!connected()) return; // still kept; the next connect tries again
        const p = pending.current.take();
        if (p) getVoice(sessionId)?.speak(p.instruction);
      }, SPEAK_AFTER_CONNECT_MS);
    };
    const attach = () => {
      unsubscribe?.();
      unsubscribe = getVoice(sessionId)?.subscribe((e) => {
        if (e.type === "state") flushSoon();
      });
      flushSoon();
    };
    attach();
    const off = onVoiceRegistryChange(attach);
    return () => {
      off();
      unsubscribe?.();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [sessionId, connected]);

  return useMemo(
    () => ({
      // Speak now, or keep it for when the voice connects.
      speak(instruction: string, cue: SpeechCue) {
        if (connected() && !timer.current) getVoice(sessionId)?.speak(instruction);
        else pending.current.set(instruction, cue);
      },
      // The learner settled these guardrails (or the whole invoice).
      settle(guardrailIds: string[], all: boolean) {
        pending.current.settle(guardrailIds, all);
      },
      // Tells the agent what the learner just did, without making it speak.
      screen(event: Pick<ScreenEvent, "summary">) {
        if (!event.summary || !connected()) return;
        getVoice(sessionId)?.sendContext(screenUpdate(event));
      },
    }),
    [sessionId, connected],
  );
}
