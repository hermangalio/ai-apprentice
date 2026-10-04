"use client";

import { useCallback, useRef, useState } from "react";
import { VoicePanel, type VoicePanelHandle } from "@/components/voice/VoicePanel";
import { askInstruction, type VoiceMode } from "@/lib/voice/protocol";
import { useInterviewer } from "@/lib/voice/useInterviewer";
import type { ScreenEvent } from "@/lib/types";

type SampleEvent = Pick<ScreenEvent, "kind" | "summary" | "field" | "before" | "after" | "action" | "entity">;

const TOOLS: Record<VoiceMode, string[]> = {
  interviewer: [],
  debrief: ["mark_gap", "teach_back", "teach_back_result"],
  tutor: ["show_expert_moment", "log_prediction", "log_intervention_outcome"],
};

const SAMPLE_SPEAK: Record<VoiceMode, string> = {
  interviewer: askInstruction("You changed the track from Standard loop to Fast track. What made you do that?"),
  debrief: "Start",
  tutor:
    "Guardrail: g_01 is about to be broken. The learner is about to advance application C-110 (MSc ETH Zurich) on the standard track.",
};

export function DevVoice(props: {
  debriefContext: string;
  tutorContext: string;
  expertName: string;
  task: string;
  sampleEvents: SampleEvent[];
}) {
  const [mode, setMode] = useState<VoiceMode>("interviewer");
  const [textOnly, setTextOnly] = useState(true);
  const [micPolicy, setMicPolicy] = useState<"default" | "open" | "gated">("default");
  const [sessionId, setSessionId] = useState("");
  const [context, setContext] = useState("");
  const [speakText, setSpeakText] = useState(SAMPLE_SPEAK.interviewer);
  const [contextLine, setContextLine] = useState("Screen: Application C-101 opened (Nina Baumann, BSc ETH Zurich, ML Engineer)");
  const [toolLog, setToolLog] = useState<string[]>([]);
  const [events, setEvents] = useState<ScreenEvent[]>([]);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [nextSample, setNextSample] = useState(0);
  const [autoAsk, setAutoAsk] = useState(true);
  const [note, setNote] = useState("");
  const panel = useRef<VoicePanelHandle>(null);

  const pickMode = (m: VoiceMode) => {
    setMode(m);
    setContext(m === "debrief" ? props.debriefContext : m === "tutor" ? props.tutorContext : "");
    setSpeakText(SAMPLE_SPEAK[m]);
  };

  const createSession = useCallback(async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: mode === "tutor" ? "learner" : "expert",
        personName: mode === "tutor" ? "Lena" : props.expertName,
        task: props.task,
      }),
    });
    const body = await res.json();
    if (res.ok) {
      setSessionId(body.id);
      setEvents([]);
      setNextSample(0);
      setNote(`Session ${body.id} created`);
    } else setNote(body.error ?? "Could not create a session");
  }, [mode, props.expertName, props.task]);

  const pushSampleEvent = useCallback(async () => {
    const sample = props.sampleEvents[nextSample];
    if (!sample || !sessionId) return;
    const res = await fetch(`/api/sessions/${sessionId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sample, wallTime: Date.now() }),
    });
    if (res.ok) {
      const stored = (await res.json()) as ScreenEvent[];
      setEvents((prev) => [...prev, ...stored]);
      setLastActivityAt(Date.now());
      setNextSample((n) => n + 1);
    } else setNote(`events returned ${res.status}`);
  }, [nextSample, props.sampleEvents, sessionId]);

  const interviewer = useInterviewer({
    sessionId,
    events,
    lastActivityAt,
    voice: panel,
    enabled: mode === "interviewer" && autoAsk && !!sessionId,
  });

  const clientTools = Object.fromEntries(
    TOOLS[mode].map((name) => [
      name,
      (params: unknown) => {
        setToolLog((prev) => [...prev, `${new Date().toLocaleTimeString()} ${name}(${JSON.stringify(params)})`]);
        return "ok";
      },
    ]),
  );

  const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm";
  const button = "rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40";

  return (
    <main className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
      <h1 className="text-lg font-semibold">Voice test page</h1>
      <p className="mt-1 max-w-3xl text-sm text-zinc-600">
        Try each agent by hand. Text only uses no microphone and no audio minutes. Create a session first so the
        transcript and the questions have somewhere to go.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[22rem_1fr_20rem]">
        <div className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="font-medium">Agent</legend>
            <div className="flex gap-2">
              {(["interviewer", "debrief", "tutor"] as VoiceMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => pickMode(m)}
                  className={`rounded px-2 py-1 text-xs ${mode === m ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} />
              Text only (no microphone)
            </label>
            <label className="flex items-center gap-2">
              Mic policy
              <select value={micPolicy} onChange={(e) => setMicPolicy(e.target.value as typeof micPolicy)} className="rounded border border-zinc-300 px-1 py-0.5">
                <option value="default">default for the agent</option>
                <option value="gated">gated</option>
                <option value="open">open</option>
              </select>
            </label>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-medium">Session</legend>
            <div className="flex gap-2">
              <input value={sessionId} onChange={(e) => setSessionId(e.target.value.trim())} placeholder="session id" className={field} />
              <button type="button" onClick={createSession} className={button}>
                New
              </button>
            </div>
            {note && <p className="text-xs text-zinc-500">{note}</p>}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-medium">Initial context (read at Start)</legend>
            <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={8} className={`${field} font-mono text-xs`} />
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-medium">Make the agent speak</legend>
            <textarea value={speakText} onChange={(e) => setSpeakText(e.target.value)} rows={3} className={field} />
            <button type="button" onClick={() => panel.current?.speak(speakText)} className={button}>
              speak(instruction)
            </button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-medium">Send context (no reply expected)</legend>
            <input value={contextLine} onChange={(e) => setContextLine(e.target.value)} className={field} />
            <button type="button" onClick={() => panel.current?.sendContext(contextLine)} className={button}>
              sendContext(text)
            </button>
          </fieldset>
        </div>

        <VoicePanel
          // Remount when the configuration changes so a fresh session starts.
          key={`${mode}-${textOnly}-${micPolicy}-${sessionId}`}
          ref={panel}
          mode={mode}
          sessionId={sessionId || "dev_voice"}
          context={context}
          clientTools={clientTools}
          micPolicy={micPolicy === "default" ? undefined : micPolicy}
          textOnly={textOnly}
          personName={mode === "tutor" ? "Lena" : props.expertName}
          expertName={props.expertName}
          task={props.task}
          className="h-[36rem]"
        />

        <div className="space-y-4 text-sm">
          {mode === "interviewer" && (
            <fieldset className="space-y-2">
              <legend className="font-medium">Capture loop</legend>
              <button type="button" onClick={pushSampleEvent} disabled={!sessionId || nextSample >= props.sampleEvents.length} className={button}>
                Send next fixture event ({nextSample}/{props.sampleEvents.length})
              </button>
              <p className="text-xs text-zinc-500">{props.sampleEvents[nextSample]?.summary ?? "No more events"}</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={autoAsk} onChange={(e) => setAutoAsk(e.target.checked)} />
                useInterviewer asks at pauses
              </label>
              <button type="button" onClick={interviewer.askNow} className={button}>
                Ask now
              </button>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-2 text-xs">
                <dt className="text-zinc-500">phase</dt>
                <dd>{interviewer.phase}</dd>
                <dt className="text-zinc-500">blocked by</dt>
                <dd>{interviewer.blockedBy.join(", ") || "nothing"}</dd>
                <dt className="text-zinc-500">current</dt>
                <dd>{interviewer.current?.text ?? "none"}</dd>
                <dt className="text-zinc-500">asked</dt>
                <dd>{interviewer.asked.length}</dd>
                <dt className="text-zinc-500">last reason</dt>
                <dd>{interviewer.lastReason ?? ""}</dd>
              </dl>
            </fieldset>
          )}
          <fieldset>
            <legend className="font-medium">Client tool calls</legend>
            {toolLog.length === 0 ? (
              <p className="text-xs text-zinc-400">None yet.</p>
            ) : (
              <ul className="space-y-1 font-mono text-[11px]">
                {toolLog.map((line, i) => (
                  <li key={i} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </div>
      </div>
    </main>
  );
}
