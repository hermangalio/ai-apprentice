"use client";
/* eslint-disable react-hooks/refs --
   Latest-value refs: timers and SDK callbacks read the newest props and SDK
   handles through refs that are synced during render, the same pattern the
   ElevenLabs React SDK uses internally. */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Question, ScreenEvent } from "../types";
import { evaluateAnswer, evaluatePause, type PauseBlock } from "./pause";
import { askInstruction, screenUpdate } from "./protocol";
import { getVoice, onVoiceRegistryChange, type VoicePanelHandle } from "./registry";

// Runs the live interviewer on the capture page:
// - sends new screen events to the agent as contextual updates,
// - watches for a pause (pause.ts),
// - asks the server for the single best question (POST questions/next),
// - has the agent ask it and opens the microphone for the answer,
// - marks the question asked, then answered once the expert has gone quiet.
//
// The hook finds the <VoicePanel> mounted with the same sessionId by itself.
// Pass `voice` to use a specific panel ref instead.

export type UseInterviewerOptions = {
  sessionId: string;
  // Date.now() of the last change seen on screen (frame diff, DOM event), or null.
  lastActivityAt: number | null;
  // All screen events of the session so far, oldest first.
  events: ScreenEvent[];
  // Date.now() of the last key press, if the page tracks it.
  lastTypingAt?: number | null;
  voice?: RefObject<VoicePanelHandle | null>;
  // Set false to stop asking (for example while off the record).
  enabled?: boolean;
};

export type InterviewerPhase = "off" | "watching" | "choosing" | "asking" | "listening";

export type InterviewerState = {
  phase: InterviewerPhase;
  // What keeps the agent quiet right now. Empty when a question could be asked.
  blockedBy: PauseBlock[];
  current: Question | null;
  // Live questions asked so far in this page session.
  asked: Question[];
  // Why the last request for a question returned nothing.
  lastReason: string | null;
};

const TICK_MS = 400;
// Do not ask the server again more often than this while nothing changed.
const REFETCH_MS = 8000;
// A chosen question may wait this long for a pause before it is chosen again.
const FRESH_MS = 20_000;
// An answer that starts after the question window closed still counts if it
// comes within this time of the question.
const LATE_ANSWER_MS = 60_000;

type Fetched = { question: Question | null; reason: string; version: number; at: number };

export function useInterviewer(opts: UseInterviewerOptions): InterviewerState & { askNow: () => void } {
  const { sessionId, enabled = true } = opts;
  const [state, setState] = useState<InterviewerState>({
    phase: "off",
    blockedBy: [],
    current: null,
    asked: [],
    lastReason: null,
  });

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [, bump] = useState(0);
  useEffect(() => onVoiceRegistryChange(() => bump((n) => n + 1)), []);
  const voice = opts.voice?.current ?? getVoice(sessionId);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const run = useRef({
    startedAt: 0, // set on mount
    sent: new Set<string>(),
    lastEventAt: null as number | null,
    version: 0, // bumps when events or speech change what could be asked
    fetched: null as Fetched | null,
    fetching: false,
    lastFetchAt: 0,
    questionTimes: [] as number[],
    asking: null as { question: Question; askedAt: number; answerIds: string[]; lastUserSpeechAt: number | null } | null,
    // The last question that timed out without an answer. An answer that
    // comes late (the expert finished a thought first) is still linked to it.
    unanswered: null as { question: Question; askedAt: number } | null,
    force: false,
  });

  const patch = useCallback((next: Partial<InterviewerState>) => {
    setState((prev) => {
      const merged = { ...prev, ...next };
      const same =
        merged.phase === prev.phase &&
        merged.current === prev.current &&
        merged.asked === prev.asked &&
        merged.lastReason === prev.lastReason &&
        merged.blockedBy.join() === prev.blockedBy.join();
      return same ? prev : merged;
    });
  }, []);

  const fetchNext = useCallback(async () => {
    const r = run.current;
    if (r.fetching) return;
    r.fetching = true;
    r.lastFetchAt = Date.now();
    const version = r.version;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/questions/next`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await res.json();
      r.fetched = res.ok
        ? { question: body.question ?? null, reason: body.reason ?? "", version, at: Date.now() }
        : { question: null, reason: body.error ?? `questions/next returned ${res.status}`, version, at: Date.now() };
    } catch (err) {
      r.fetched = { question: null, reason: err instanceof Error ? err.message : "request failed", version, at: Date.now() };
    } finally {
      r.fetching = false;
    }
  }, [sessionId]);

  const patchQuestion = useCallback(
    (id: string, body: Record<string, unknown>) =>
      fetch(`/api/sessions/${sessionId}/questions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {}),
    [sessionId],
  );

  // Utterances from the panel: speech bumps the version (the expert may have
  // just explained something) and answers are collected while listening.
  useEffect(() => {
    if (!voice) return;
    return voice.subscribe((event) => {
      if (event.type !== "utterance" || event.speaker === "agent") return;
      const r = run.current;
      r.version++;
      if (r.asking && event.at >= r.asking.askedAt) {
        r.asking.lastUserSpeechAt = event.at;
        if (event.transcriptId) r.asking.answerIds.push(event.transcriptId);
      } else if (r.unanswered && event.at - r.unanswered.askedAt < LATE_ANSWER_MS) {
        void patchQuestion(r.unanswered.question.id, {
          status: "answered",
          answerTranscriptIds: event.transcriptId ? [event.transcriptId] : [],
        });
        r.unanswered = null;
      }
    });
  }, [voice, patchQuestion]);

  useEffect(() => {
    if (!run.current.startedAt) run.current.startedAt = Date.now();
    const tick = () => {
      if (!enabled) {
        patch({ phase: "off", blockedBy: [] });
        return;
      }
      const r = run.current;
      const v = voiceRef.current;
      const o = optsRef.current;
      if (!v || v.status !== "connected") {
        patch({ phase: "off", blockedBy: [] });
        return;
      }
      const now = Date.now();
      const vs = v.getState();

      // New screen events go to the agent as context and count as screen activity.
      let added = false;
      for (const e of o.events) {
        if (r.sent.has(e.id)) continue;
        v.sendContext(screenUpdate(e));
        r.sent.add(e.id);
        added = true;
      }
      if (added) {
        r.lastEventAt = now;
        r.version++;
      }

      // A question is out: wait for the answer, then close the microphone.
      if (r.asking) {
        const lastUserSpeechAt = Math.max(vs.lastUserSpeechAt ?? 0, r.asking.lastUserSpeechAt ?? 0) || null;
        const answer = evaluateAnswer({
          now,
          askedAt: r.asking.askedAt,
          lastUserSpeechAt,
          agentSpeaking: vs.agentSpeaking,
          lastAgentSpeechAt: vs.lastAgentSpeechAt,
        });
        if (answer === "answered" || answer === "unanswered") {
          const done = r.asking;
          r.asking = null;
          v.closeMic();
          r.unanswered = answer === "unanswered" ? { question: done.question, askedAt: done.askedAt } : null;
          if (answer === "answered") {
            // Transcript ids can arrive a moment after the speech ended.
            setTimeout(() => patchQuestion(done.question.id, { status: "answered", answerTranscriptIds: done.answerIds }), 1500);
          }
          r.version++;
          patch({ phase: "watching", current: null });
        } else {
          patch({ phase: vs.agentSpeaking ? "asking" : "listening" });
        }
        return;
      }

      const lastScreenActivityAt = Math.max(o.lastActivityAt ?? 0, r.lastEventAt ?? 0) || null;
      const decision = evaluatePause({
        now,
        sessionStartedAt: r.startedAt,
        lastScreenActivityAt,
        lastTypingAt: o.lastTypingAt,
        lastUserSpeechAt: vs.lastUserSpeechAt,
        agentSpeaking: vs.agentSpeaking,
        lastAgentSpeechAt: vs.lastAgentSpeechAt,
        questionTimes: r.questionTimes,
      });

      // A fetched question is only good for the state it was chosen for, and
      // only for a short time: it has to be about what is on screen now.
      const usable =
        r.fetched && r.fetched.version === r.version && !(r.fetched.question && now - r.fetched.at > FRESH_MS);
      const current = usable ? r.fetched : null;
      // Keep the server's analysis warm: ask as soon as something changed,
      // without waiting for the pause.
      const stale = !current && now - r.lastFetchAt > 1000;
      const retry = current && !current.question && now - current.at > REFETCH_MS && decision.open;
      if (!r.fetching && (stale || retry) && r.sent.size > 0) void fetchNext();

      const open = decision.open || r.force;
      if (!open) {
        patch({ phase: "watching", blockedBy: decision.blockedBy, lastReason: current?.reason ?? null });
        return;
      }
      if (!current || !current.question) {
        patch({ phase: r.fetching ? "choosing" : "watching", blockedBy: [], lastReason: current?.reason ?? null });
        if (!r.fetching) r.force = false;
        return;
      }

      // Ask it.
      const question = current.question;
      r.force = false;
      r.fetched = null;
      r.questionTimes.push(now);
      r.asking = { question, askedAt: now, answerIds: [], lastUserSpeechAt: null };
      r.unanswered = null;
      r.version++;
      v.speak(askInstruction(question.text));
      void patchQuestion(question.id, { status: "asked", askedIn: "capture" });
      setState((prev) => ({ ...prev, phase: "asking", blockedBy: [], current: question, asked: [...prev.asked, question] }));
    };
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, fetchNext, patch, patchQuestion]);

  // Ask the next question at once, ignoring the pause rules (dev page, demo fallback).
  const askNow = useCallback(() => {
    run.current.force = true;
    run.current.lastFetchAt = 0;
    run.current.fetched = null;
  }, []);

  return { ...state, askNow };
}
