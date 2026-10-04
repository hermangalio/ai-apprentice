"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Frame, Prediction, Scorecard, ScreenEvent, ScreenMoment, Session, WorkMap } from "@/lib/types";
import { ERP_HIGHLIGHT_FIELDS, type ErpControlMessage } from "@/lib/erp/events";
import { caseIdOf, caseParts, factNames, highlightField, wantsModelCheck } from "@/lib/teach/check";
import { createCueTracker, createOnce, isTypingPing, type TrackUpdate } from "@/lib/teach/cues";
import type { CheckResponse, PredictionCue } from "@/lib/teach/engine";
import type { Progress, ScoreItem } from "@/lib/teach/progress";
import type { TeachIntervention } from "@/lib/teach/state";
import { tutorClientTools, type TutorClientTools } from "@/lib/teach/tutorTools";
import { ExpertReplay } from "./ExpertReplay";
import { ScorecardView } from "./ScorecardView";

// The tutor side panel. It polls the learner session, checks every new event
// against the Work Map and shows the intervention as text, so it works with
// no voice connected. With voice, `onIntervention` hands the same instruction
// to the voice agent. Each intervention is also sent to the sandbox tab as a
// coach message, so the learner sees it where they work.

export type VoiceWiring = { sessionId: string; context: string; clientTools: TutorClientTools };

export type TutorCue = { kind: "intervention" | "prediction"; guardrailId?: string; stepId?: string };

export type TeachPanelProps = {
  learnerSessionId: string;
  // Where the voice panel goes. A function receives the tutor context text
  // and the client tools once the Work Map is loaded.
  voiceSlot?: ReactNode | ((wiring: VoiceWiring) => ReactNode);
  // Called once per new intervention or prediction question with the
  // instruction text for the voice agent (pass it to VoicePanel's speak()).
  onIntervention?: (instruction: string, cue: TutorCue) => void;
  // Called when open interventions are settled: the learner corrected the
  // value (guardrailIds), or the case was committed or left (all).
  onSettled?: (guardrailIds: string[], all: boolean) => void;
  // Called once per new learner screen event (typing pings left out), for
  // the voice agent's "Screen:" lines.
  onLearnerEvent?: (event: Pick<ScreenEvent, "kind" | "summary">) => void;
};

// What handleResult needs to know about the event a result belongs to.
type EventMeta = { t: number; wall: number; kind?: string; committed?: boolean };
type LearnerEvent = Partial<ScreenEvent> & { wallTime?: number };

type PanelState = {
  session: Session;
  events: ScreenEvent[];
  progress: Progress;
  interventions: TeachIntervention[];
  predictions: Prediction[];
};
type FullState = PanelState & { workMap: WorkMap; expertEvents: ScreenEvent[]; expertFrames: Frame[]; context: string };

const POLL_MS = 600;
// Seconds the question stands alone before the expert's reason is shown.
const REASON_DELAY_MS = 6000;
const ERP_EVENTS = "erp-events";
const ERP_CONTROL = "erp-control";
// Stored events older than this are history: no "Screen:" line, no model call.
const RECENT_MS = 15000;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type ActiveCue = PredictionCue & { caseId?: string; t: number; answer: string; revealed: boolean };

export function TeachPanel({ learnerSessionId, voiceSlot, onIntervention, onSettled, onLearnerEvent }: TeachPanelProps) {
  const [full, setFull] = useState<FullState | null>(null);
  const [live, setLive] = useState<PanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cue, setCue] = useState<ActiveCue | null>(null);
  const [reasonShown, setReasonShown] = useState<Record<string, boolean>>({});
  const [replay, setReplay] = useState<{ guardrailId?: string; stepId?: string } | null>(null);
  const [score, setScore] = useState<{ scorecard: Scorecard; items: ScoreItem[] } | null>(null);
  const [ending, setEnding] = useState(false);

  const checked = useRef(new Set<string>());
  const busy = useRef(false);
  const fullRef = useRef<FullState | null>(null);
  const liveRef = useRef<PanelState | null>(null);
  const onInterventionRef = useRef(onIntervention);
  const onSettledRef = useRef(onSettled);
  const onLearnerEventRef = useRef(onLearnerEvent);
  const tracker = useRef(createCueTracker());
  // Guardrail of the coach message currently shown in the sandbox tab.
  const coachFor = useRef<string | null>(null);
  const screenOnce = useRef(createOnce());
  const modelOnce = useRef(createOnce());
  // Guardrails the model raised an intervention for on the case on screen.
  const modelRaised = useRef<{ caseId?: string; ids: Set<string> }>({ ids: new Set() });
  const control = useRef<BroadcastChannel | null>(null);
  const reasonTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    onInterventionRef.current = onIntervention;
    onSettledRef.current = onSettled;
    onLearnerEventRef.current = onLearnerEvent;
  }, [onIntervention, onSettled, onLearnerEvent]);

  const postControl = useCallback((msg: ErpControlMessage) => control.current?.postMessage(msg), []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(ERP_CONTROL);
    control.current = ch;
    return () => {
      ch.close();
      control.current = null;
    };
  }, []);

  const refresh = useCallback(async () => {
    const wantFull = !fullRef.current;
    const res = await fetch(`/api/teach/state?learnerSessionId=${learnerSessionId}${wantFull ? "&full=1" : ""}`, {
      cache: "no-store",
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    if (wantFull) {
      fullRef.current = body as FullState;
      setFull(body as FullState);
    }
    liveRef.current = body as PanelState;
    setLive(body as PanelState);
    setError(null);
    return body as PanelState;
  }, [learnerSessionId]);

  // Acts on one check result: speak, coach in the sandbox tab, show the
  // prediction question.
  const handleResult = useCallback(
    (res: CheckResponse, event: EventMeta): TrackUpdate => {
      const track = tracker.current.update(res, event);
      // A late answer about an earlier step (a slow model check, or the stored
      // copy of a live event) must not undo what a newer step showed.
      if (track.stale) return track;
      if (track.all || track.settled.length) onSettledRef.current?.(track.settled, track.all);

      let coached = false;
      for (const v of res.violations) {
        if (v.repeat) continue;
        onInterventionRef.current?.(v.instruction, { kind: "intervention", guardrailId: v.guardrailId, stepId: v.stepId });
        // The element to highlight comes from the guardrail's check, matched
        // against the names the sandbox says it can highlight.
        const g = fullRef.current?.workMap.guardrails.find((x) => x.id === v.guardrailId);
        const field = (g && highlightField(g, ERP_HIGHLIGHT_FIELDS)) ?? v.field;
        if (field) postControl({ type: "highlight", field });
        // "broken" is already confirmed: nothing left to hold back in the sandbox.
        postControl({ type: "coach", text: v.question, field, severity: v.severity === "broken" ? "hint" : "stop" });
        coachFor.current = v.guardrailId;
        coached = true;
        setReplay(null);
      }
      // The learner corrected the value, or committed or left the case.
      if (!coached && coachFor.current && (track.all || track.settled.includes(coachFor.current))) {
        postControl({ type: "coach_clear" });
        coachFor.current = null;
      }

      if (res.prediction) {
        if (!res.prediction.repeat) {
          onInterventionRef.current?.(res.prediction.instruction, { kind: "prediction", stepId: res.prediction.stepId });
        }
        const next = { ...res.prediction, caseId: res.caseId, t: event.t, answer: "", revealed: false };
        // The stored copy of an event already checked live must not reset the card.
        setCue((prev) => (prev && prev.caseId === next.caseId && prev.stepId === next.stepId ? prev : next));
      }
      return track;
    },
    [postControl],
  );

  const check = useCallback(
    async (event: LearnerEvent, opts: { persist?: boolean; model?: boolean } = {}) => {
      const res = await fetch("/api/teach/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // DOM events are decided by rule first, so the answer is immediate.
        // The model is asked for vision events, and in a second call (see
        // askModel) for guardrails the rules could not decide.
        body: JSON.stringify({
          learnerSessionId,
          event,
          persist: opts.persist === true,
          useModel: opts.model === true || event.source === "vision",
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as CheckResponse;
    },
    [learnerSessionId],
  );

  // Second pass for guardrails without a usable `check`. Runs only at an
  // case open or a confirmation step, never blocks the rule result, and
  // adds its findings when they arrive. Rule violations of the same event
  // come back marked as repeats, so nothing is said twice.
  // One more case: a commit that closes an intervention the model raised.
  // The rules cannot tell whether it was corrected or overridden, so the
  // model is asked for the outcome.
  const askModel = useCallback(
    (event: LearnerEvent, first: CheckResponse, meta: EventMeta, track: TrackUpdate) => {
      if (event.source === "vision" || first.skipped || track.stale || !first.undecided?.length) return;
      if (!event.kind) return;
      const raised = modelRaised.current;
      const closesModelCue =
        event.kind === "action" &&
        event.committed === true &&
        raised.caseId === first.caseId &&
        first.undecided.some((id) => raised.ids.has(id));
      if (closesModelCue) raised.ids.clear();
      if (!closesModelCue && !wantsModelCheck({ ...event, kind: event.kind })) return;
      if (Date.now() - meta.wall > RECENT_MS) return;
      const key = `${first.caseId ?? ""}|${event.kind}|${event.action ?? ""}|${event.committed === true}`;
      if (!modelOnce.current.first(key, meta.wall)) return;
      void check(event, { model: true })
        .then((res) => {
          if (!res) return;
          handleResult(res, meta);
          if (!closesModelCue) {
            if (raised.caseId !== res.caseId) {
              raised.caseId = res.caseId;
              raised.ids.clear();
            }
            for (const v of res.violations) if (first.undecided.includes(v.guardrailId)) raised.ids.add(v.guardrailId);
          }
          if (closesModelCue || res.violations.some((v) => !v.repeat) || (res.prediction && !res.prediction.repeat)) {
            void refresh().catch(() => {});
          }
        })
        .catch(() => {});
    },
    [check, handleResult, refresh],
  );

  // Passes a new learner step on for the voice agent's "Screen:" lines.
  const noteLearnerEvent = useCallback((event: LearnerEvent, wall: number) => {
    if (!event.kind || !event.summary || isTypingPing(event)) return;
    if (Date.now() - wall > RECENT_MS) return;
    if (!screenOnce.current.first(`${caseIdOf(event) ?? ""}|${event.kind}|${event.summary}`, wall)) return;
    onLearnerEventRef.current?.({ kind: event.kind, summary: event.summary });
  }, []);

  // Poll the session and check events that have not been checked yet.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const state = await refresh();
        const startedAt = Date.parse(state.session.startedAt);
        let acted = false;
        for (const e of state.events) {
          if (stopped) break;
          if (checked.current.has(e.id)) continue;
          checked.current.add(e.id);
          const meta = { t: e.t, wall: startedAt + e.t, kind: e.kind, committed: e.committed };
          noteLearnerEvent(e, meta.wall);
          if (e.kind === "other" && !e.action) continue;
          const res = await check(e);
          if (res) {
            askModel(e, res, meta, handleResult(res, meta));
            acted = acted || res.violations.length > 0 || e.committed === true;
          }
        }
        if (acted && !stopped) await refresh();
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refresh, check, handleResult, askModel, noteLearnerEvent]);

  // Fast path: sandbox events arrive here over the BroadcastChannel before they
  // reach the server. Check them at once. If no other tab stores the event
  // within a few seconds, store it from here so progress still works.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(ERP_EVENTS);
    ch.onmessage = (msg: MessageEvent) => {
      const data = msg.data as (Partial<ScreenEvent> & { wallTime?: number }) | null;
      if (!data || typeof data !== "object" || !data.kind) return;
      const wallTime = typeof data.wallTime === "number" ? data.wallTime : Date.now();
      noteLearnerEvent(data, wallTime);
      if (data.kind === "other" && !data.action) return;
      const id = `live_${Math.round(wallTime)}`;
      const event = { ...data, id, wallTime, source: "dom" as const };
      checked.current.add(id);
      const startedAt = liveRef.current ? Date.parse(liveRef.current.session.startedAt) : wallTime;
      void check(event).then((res) => {
        if (!res) return;
        const meta = { t: Math.max(0, wallTime - startedAt), wall: wallTime, kind: data.kind, committed: data.committed };
        askModel(event, res, meta, handleResult(res, meta));
        if (res.violations.length) void refresh().catch(() => {});
      });
      setTimeout(() => {
        const started = liveRef.current ? Date.parse(liveRef.current.session.startedAt) : NaN;
        const t = wallTime - started;
        const stored = (liveRef.current?.events ?? []).some(
          (e) =>
            e.kind === data.kind &&
            (e.field ?? "") === (data.field ?? "") &&
            (e.after ?? "") === (data.after ?? "") &&
            (e.action ?? "") === (data.action ?? "") &&
            // The request and the confirmation of an action differ only here.
            (e.committed === true) === (data.committed === true) &&
            (caseIdOf(e) ?? "") === (caseIdOf(data) ?? "") &&
            Math.abs(e.t - t) < 4000,
        );
        if (!stored) void check(event, { persist: true }).then(() => refresh().catch(() => {}));
      }, 3000);
    };
    return () => ch.close();
  }, [check, handleResult, askModel, noteLearnerEvent, refresh]);

  const clientTools = useMemo(
    () =>
      // The refs are read when the agent calls a tool, not during render.
      // eslint-disable-next-line react-hooks/refs
      tutorClientTools(learnerSessionId, {
        onShowExpertMoment: ({ guardrailId, stepId }) => {
          const wm = fullRef.current?.workMap;
          const moment =
            wm?.guardrails.find((g) => g.id === guardrailId)?.moment ?? wm?.steps.find((s) => s.id === stepId)?.moment;
          if (!moment) return;
          setReplay({ guardrailId, stepId });
          if (guardrailId) {
            // Showing the moment implies the reason has been given.
            setReasonShown((r) => {
              const next = { ...r };
              for (const i of liveRef.current?.interventions ?? []) if (i.guardrailId === guardrailId) next[i.id] = true;
              return next;
            });
          }
          return moment.label;
        },
        onPrediction: () => void refresh().catch(() => {}),
        onOutcome: () => void refresh().catch(() => {}),
      }),
    [learnerSessionId, refresh],
  );

  const interventions = useMemo(() => live?.interventions ?? [], [live]);

  // Question first, then the reason: reveal the quote after a short delay.
  useEffect(() => {
    const started = live ? Date.parse(live.session.startedAt) : NaN;
    for (const i of interventions) {
      if (reasonShown[i.id] || reasonTimers.current[i.id]) continue;
      const age = Date.now() - (started + i.t);
      const wait = i.outcome || !(age < REASON_DELAY_MS) ? 0 : REASON_DELAY_MS - Math.max(0, age);
      reasonTimers.current[i.id] = setTimeout(() => setReasonShown((r) => ({ ...r, [i.id]: true })), wait);
    }
  }, [interventions, reasonShown, live]);
  useEffect(() => {
    const timers = reasonTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const logPrediction = async (correct: boolean) => {
    if (!cue) return;
    await clientTools.log_prediction({ step_id: cue.stepId, prompt: cue.prompt, learner_answer: cue.answer, correct });
    setCue(null);
  };

  const endSession = async () => {
    setEnding(true);
    try {
      const res = await fetch(`/api/sessions/${learnerSessionId}/scorecard`, { method: "POST" });
      if (res.ok) setScore(await res.json());
      else setError(`Scorecard failed: HTTP ${res.status}`);
    } finally {
      setEnding(false);
    }
  };

  if (!full || !live) {
    return (
      <div className="min-h-screen bg-stone-50 p-4 text-sm text-stone-600">
        {error ? `Could not load the session: ${error}` : "Loading the tutor…"}
      </div>
    );
  }

  const { workMap, expertEvents, expertFrames, context } = full;
  const { progress, session, predictions } = live;
  const who = workMap.expertName;
  const guardrailById = new Map(workMap.guardrails.map((g) => [g.id, g]));
  const facts = progress.facts;
  // The case header is built from whatever facts the events carry.
  const caseType = progress.caseType;
  const parts = caseParts(facts, factNames(workMap));
  const status = typeof facts.status === "string" ? facts.status.replace(/_/g, " ") : undefined;

  const here = interventions.filter((i) => i.caseId && i.caseId === progress.caseId);
  const active = here[here.length - 1];
  const earlier = interventions.filter((i) => i !== active).reverse();
  const cueVisible =
    cue &&
    cue.caseId === progress.caseId &&
    !progress.closed &&
    !here.some((i) => i.guardrailId === cue.guardrailId) &&
    !predictions.some((p) => p.stepId === cue.stepId && p.t >= cue.t);

  const replayMoment: ScreenMoment | undefined = replay
    ? (guardrailById.get(replay.guardrailId ?? "")?.moment ?? workMap.steps.find((s) => s.id === replay.stepId)?.moment)
    : undefined;
  // The tutor asked for a moment that the active card is not already showing.
  const standaloneReplay = replayMoment && !(active && replay?.guardrailId === active.guardrailId);

  const slot = typeof voiceSlot === "function" ? voiceSlot({ sessionId: learnerSessionId, context, clientTools }) : voiceSlot;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            Tutor · taught from {who}&apos;s Work Map
          </p>
          <h1 className="text-base font-semibold leading-snug">{workMap.task}</h1>
          <p className="text-xs text-stone-500">Learner: {session.personName}</p>
        </header>

        {slot && <div>{slot}</div>}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        {score ? (
          <ScorecardView
            scorecard={score.scorecard}
            items={score.items}
            learnerName={session.personName}
            onBack={() => setScore(null)}
          />
        ) : (
          <>
            {/* The case on screen */}
            <section className="rounded-lg border border-stone-200 bg-white px-3 py-2.5">
              {progress.caseId ? (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold">
                      {cap(caseType)} {progress.caseId}
                    </h2>
                    <span className="text-xs text-stone-500">{progress.closed ? (status ?? "closed") : "open"}</span>
                  </div>
                  {parts.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                      {parts.map((part) => (
                        <span key={part} className="rounded bg-stone-100 px-1.5 py-0.5">
                          {part}
                        </span>
                      ))}
                    </p>
                  )}
                  {progress.closed && (
                    <p className="mt-1.5 text-xs text-stone-500">Done. Open the next {caseType} in the other tab.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-stone-600">
                  Waiting for the first case. Open one in the other tab and work it as you would on your own.
                </p>
              )}
            </section>

            {/* Intervention */}
            {active && (() => {
              const g = guardrailById.get(active.guardrailId);
              const settled = active.outcome === "corrected";
              const broken = active.severity === "broken" || active.outcome === "overridden";
              const shown = reasonShown[active.id] || Boolean(active.outcome);
              const tone = settled
                ? "border-emerald-300 bg-emerald-50"
                : broken
                  ? "border-red-300 bg-red-50"
                  : "border-amber-400 bg-amber-50";
              return (
                <section className={`rounded-lg border-2 px-3 py-3 ${tone}`} aria-live="assertive">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-700">
                    {settled
                      ? "Corrected before confirming"
                      : broken
                        ? "Confirmed against a rule · on your practice list"
                        : "Stop · not confirmed yet"}
                  </p>
                  <p className="mt-1.5 text-base font-semibold leading-snug">{active.question}</p>
                  {!shown ? (
                    <button
                      type="button"
                      onClick={() => setReasonShown((r) => ({ ...r, [active.id]: true }))}
                      className="mt-2 text-xs font-medium text-stone-700 underline underline-offset-2"
                    >
                      Show {who}&apos;s reason
                    </button>
                  ) : (
                    <>
                      <blockquote className="mt-2 border-l-4 border-stone-800 pl-3 text-sm leading-snug">
                        “{active.quote}”
                        <footer className="mt-1 text-xs text-stone-600">
                          {who}&apos;s own words{g?.escalateTo ? ` · Go to: ${g.escalateTo}` : ""}
                        </footer>
                      </blockquote>
                      <p className="mt-2 text-xs text-stone-700">{g?.rule}</p>
                      {g && (
                        <div className="mt-3">
                          <ExpertReplay
                            key={active.id}
                            expertSessionId={workMap.sessionId}
                            expertName={who}
                            frames={expertFrames}
                            events={expertEvents}
                            moment={g.moment}
                          />
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })()}

            {/* Prediction question */}
            {cueVisible && cue && (
              <section className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-900">Your call first</p>
                <p className="mt-1.5 text-sm font-semibold leading-snug">{cue.prompt}</p>
                {!cue.revealed ? (
                  <>
                    <textarea
                      value={cue.answer}
                      onChange={(e) => setCue((c) => (c ? { ...c, answer: e.target.value } : c))}
                      rows={2}
                      placeholder="Say it to the tutor, or type it here"
                      className="mt-2 w-full rounded-md border border-sky-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500"
                    />
                    <button
                      type="button"
                      onClick={() => setCue((c) => (c ? { ...c, revealed: true } : c))}
                      className="mt-2 rounded-md bg-sky-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-900"
                    >
                      Show what {who} does
                    </button>
                  </>
                ) : (
                  <>
                    <blockquote className="mt-2 border-l-4 border-sky-800 pl-3 text-sm leading-snug">
                      “{cue.quote}”<footer className="mt-1 text-xs text-stone-600">{who}</footer>
                    </blockquote>
                    <p className="mt-2 text-xs text-stone-700">{cue.rule}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void logPrediction(true)}
                        className="rounded-md border border-sky-800 px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-100"
                      >
                        I had that
                      </button>
                      <button
                        type="button"
                        onClick={() => void logPrediction(false)}
                        className="rounded-md border border-stone-400 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                      >
                        I missed it
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* A moment the tutor asked to show */}
            {standaloneReplay && replayMoment && (
              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-600">How {who} did it</h2>
                  <button type="button" onClick={() => setReplay(null)} className="text-xs text-stone-500 hover:underline">
                    Close
                  </button>
                </div>
                <ExpertReplay
                  key={`${replay?.guardrailId ?? ""}:${replay?.stepId ?? ""}`}
                  expertSessionId={workMap.sessionId}
                  expertName={who}
                  frames={expertFrames}
                  events={expertEvents}
                  moment={replayMoment}
                />
              </section>
            )}

            {/* Steps */}
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-600">The process, step by step</h2>
              <ol className="space-y-1.5">
                {workMap.steps
                  .slice()
                  .sort((a, b) => a.index - b.index)
                  .map((step) => {
                    const p = progress.steps.find((s) => s.id === step.id);
                    const status = p?.status ?? "upcoming";
                    const rules = step.guardrailIds.map((id) => guardrailById.get(id)).filter((g) => g !== undefined);
                    // While the tutor's question stands alone, the answer stays hidden here too.
                    const held =
                      active !== undefined &&
                      step.guardrailIds.includes(active.guardrailId) &&
                      !(reasonShown[active.id] || Boolean(active.outcome));
                    const revealed = Boolean(p?.revealed) && !held;
                    return (
                      <li
                        key={step.id}
                        className={`rounded-lg border px-3 py-2 ${
                          status === "current"
                            ? "border-stone-800 bg-white shadow-sm"
                            : status === "done"
                              ? "border-stone-200 bg-white"
                              : "border-transparent bg-stone-100"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                              status === "done"
                                ? "bg-emerald-600 text-white"
                                : status === "current"
                                  ? "bg-stone-800 text-white"
                                  : "bg-stone-300 text-stone-600"
                            }`}
                          >
                            {status === "done" ? "✓" : step.index}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm leading-snug ${status === "upcoming" ? "text-stone-500" : "font-medium"}`}>
                              {step.title}
                              {status === "current" && (
                                <span className="ml-2 rounded bg-stone-800 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase text-white">
                                  now
                                </span>
                              )}
                            </p>
                            {revealed && (
                              <div className="mt-1.5 space-y-1.5">
                                <p className="text-xs text-stone-600">
                                  {who}: {step.decision}
                                </p>
                                {step.reason && (
                                  <p className="border-l-2 border-stone-400 pl-2 text-xs italic leading-snug text-stone-700">
                                    “{step.reason.text}”
                                  </p>
                                )}
                                {rules.map((g) => (
                                  <p key={g.id} className="text-xs text-stone-700">
                                    <span
                                      className={`mr-1 rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${
                                        p?.atStake ? "bg-amber-300 text-stone-900" : "bg-stone-200 text-stone-700"
                                      }`}
                                    >
                                      rule
                                    </span>
                                    {g.rule}
                                  </p>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setReplay({ stepId: step.id })}
                                  className="text-xs font-medium text-stone-600 underline underline-offset-2"
                                >
                                  Watch {who} do it ({step.moment.label.split(",")[0]})
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
              </ol>
              <p className="mt-2 text-[11px] text-stone-500">
                {who}&apos;s reason appears once you have done a step or answered the tutor&apos;s question about it.
              </p>
            </section>

            {/* Earlier interventions */}
            {earlier.length > 0 && (
              <section>
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-600">Earlier in this session</h2>
                <ul className="space-y-1">
                  {earlier.map((i) => (
                    <li key={i.id} className="flex items-start gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          i.outcome === "corrected" ? "bg-emerald-500" : i.outcome === "overridden" ? "bg-red-500" : "bg-amber-500"
                        }`}
                      />
                      <span className="text-stone-700">
                        {cap(i.caseType ?? caseType)} {i.caseId ?? "?"}: {guardrailById.get(i.guardrailId)?.rule ?? i.guardrailId}{" "}
                        <span className="text-stone-500">
                          ({i.outcome === "corrected" ? "corrected" : i.outcome === "overridden" ? "went ahead anyway" : "open"})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <button
              type="button"
              onClick={() => void endSession()}
              disabled={ending}
              className="rounded-lg bg-stone-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
            >
              {ending ? "Building the scorecard…" : "End session and show scorecard"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
