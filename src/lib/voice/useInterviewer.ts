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
// - instructs the agent to ask it (the panel opens the microphone for the
//   answer once the agent has finished speaking),
// - marks the question asked when the agent's utterance has arrived, and
//   answered once the expert has replied and gone quiet. A question the
//   agent never spoke stays queued.
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
// The analysis behind a question takes a few seconds. A question chosen
// before the latest event or remark is still used when a pause opens, if it
// is at most this old. Otherwise short pauses would pass while every new
// event or sentence restarts the analysis.
const STALE_OK_MS = 10_000;
// The agent's utterance has to arrive this soon after the instruction.
// Otherwise the question was not spoken and goes back to the queue.
const AGENT_REPLY_TIMEOUT_MS = 8000;
// After a question that was not spoken, wait this long before the next try.
const RETRY_AFTER_SILENT_MS = 10_000;
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
    // When a committed action (post, hold, send for approval) was last seen.
    lastCommitAt: null as number | null,
    version: 0, // bumps when events or speech change what could be asked
    fetched: null as Fetched | null,
    fetching: false,
    lastFetchAt: 0,
    questionTimes: [] as number[],
    // The question that is out. instructedAt: the agent was told to ask it.
    // spokenAt: the agent's utterance arrived; null until then.
    asking: null as {
      question: Question;
      instructedAt: number;
      spokenAt: number | null;
      answerIds: string[];
      lastUserSpeechAt: number | null;
    } | null,
    // When the agent last failed to speak a question it was given.
    silentAt: null as number | null,
    // The last question that timed out without an answer. An answer that
    // comes late (the expert finished a thought first) is still linked to it.
    unanswered: null as { question: Question; askedAt: number } | null,
    force: false,
    // True once the open question and the microphone were shut for a disabled spell.
    shut: false,
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
      if (event.type !== "utterance") return;
      const r = run.current;
      if (event.speaker === "agent") {
        // The agent's utterance after the instruction is the question. Only
        // now is it stored as asked and counted against the live budget.
        if (r.asking && r.asking.spokenAt === null) {
          const { question } = r.asking;
          r.asking.spokenAt = event.endedAt;
          r.questionTimes.push(event.endedAt);
          void patchQuestion(question.id, { status: "asked", askedIn: "capture" });
          setState((prev) => ({ ...prev, asked: [...prev.asked, question] }));
        }
        return;
      }
      r.version++;
      if (r.asking) {
        // Speech that ended after the question was spoken is the answer.
        if (r.asking.spokenAt !== null && event.endedAt >= r.asking.spokenAt) {
          r.asking.lastUserSpeechAt = event.endedAt;
          if (event.transcriptId) r.asking.answerIds.push(event.transcriptId);
        }
      } else if (r.unanswered && event.endedAt - r.unanswered.askedAt < LATE_ANSWER_MS) {
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
      const r = run.current;
      const v = voiceRef.current;
      if (!enabled) {
        // Paused or off the record: stop listening at once and give up the
        // question that was out. It keeps its stored status ("asked" if the
        // agent had spoken it, so the debrief picks it up) unless the
        // off-the-record purge removes it.
        // A question chosen earlier is not reused: it may be about moments
        // that have just been purged.
        if (!r.shut) {
          r.shut = true;
          v?.closeMic();
          r.asking = null;
          r.unanswered = null;
          r.fetched = null;
          r.force = false;
          r.version++;
        }
        patch({ phase: "off", blockedBy: [], current: null });
        return;
      }
      r.shut = false;
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
        // A vision event describes a frame whose change already counted as
        // screen activity when it was captured, seconds ago. A DOM event is
        // reported as it happens.
        if (e.source === "dom") r.lastEventAt = now;
        if (e.kind === "action" && e.committed === true) r.lastCommitAt = now;
      }
      if (added) r.version++;

      // A question is out: wait for the agent to say it, then for the
      // answer, then close the microphone.
      if (r.asking) {
        if (r.asking.spokenAt === null) {
          if (now - r.asking.instructedAt > AGENT_REPLY_TIMEOUT_MS) {
            // Nothing was said. The question keeps its stored status "queued".
            r.asking = null;
            r.silentAt = now;
            v.closeMic();
            r.version++;
            patch({ phase: "watching", current: null, lastReason: "The apprentice did not speak the question. It stays queued." });
          } else {
            patch({ phase: "asking" });
          }
          return;
        }
        const askedAt = r.asking.spokenAt;
        const lastUserSpeechAt = Math.max(vs.lastUserSpeechAt ?? 0, r.asking.lastUserSpeechAt ?? 0) || null;
        const answer = evaluateAnswer({
          now,
          askedAt,
          lastUserSpeechAt,
          agentSpeaking: vs.agentSpeaking,
          lastAgentSpeechAt: vs.lastAgentSpeechAt,
        });
        if (answer === "answered" || answer === "unanswered") {
          const done = r.asking;
          r.asking = null;
          v.closeMic();
          r.unanswered = answer === "unanswered" ? { question: done.question, askedAt } : null;
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
        lastCommitAt: r.lastCommitAt,
        lastUserSpeechAt: vs.lastUserSpeechAt,
        agentSpeaking: vs.agentSpeaking,
        lastAgentSpeechAt: vs.lastAgentSpeechAt,
        questionTimes: r.questionTimes,
      });

      // A fetched question is only good for the state it was chosen for, and
      // only for a short time: it has to be about what is on screen now.
      const upToDate = !!r.fetched && r.fetched.version === r.version;
      const usable =
        r.fetched &&
        (upToDate
          ? !(r.fetched.question && now - r.fetched.at > FRESH_MS)
          : // Chosen before the latest change: good for a short while.
            !!r.fetched.question && now - r.fetched.at <= STALE_OK_MS);
      const current = usable ? r.fetched : null;
      // Keep the server's analysis warm: ask as soon as something changed,
      // without waiting for the pause.
      const stale = !upToDate && now - r.lastFetchAt > 1000;
      const retry = current && !current.question && now - current.at > REFETCH_MS && decision.open;
      if (!r.fetching && (stale || retry) && r.sent.size > 0) void fetchNext();

      // The agent stayed silent on the last try: do not try again at once.
      const backoff = r.silentAt !== null && now - r.silentAt < RETRY_AFTER_SILENT_MS;
      const open = (decision.open && !backoff) || r.force;
      if (!open) {
        patch({ phase: "watching", blockedBy: decision.blockedBy, lastReason: current?.reason ?? null });
        return;
      }
      if (!current || !current.question) {
        patch({ phase: r.fetching ? "choosing" : "watching", blockedBy: [], lastReason: current?.reason ?? null });
        if (!r.fetching) r.force = false;
        return;
      }

      // Ask it. The question is stored as asked when the agent's utterance
      // arrives (see the subscription above), not here.
      const question = current.question;
      r.force = false;
      r.fetched = null;
      if (!v.speak(askInstruction(question.text))) {
        // Not sent: the connection went away or the panel is paused.
        r.silentAt = now;
        patch({ phase: "watching", blockedBy: [], lastReason: "The question could not be sent to the apprentice." });
        return;
      }
      r.asking = { question, instructedAt: now, spokenAt: null, answerIds: [], lastUserSpeechAt: null };
      r.unanswered = null;
      r.version++;
      setState((prev) => ({ ...prev, phase: "asking", blockedBy: [], current: question }));
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
