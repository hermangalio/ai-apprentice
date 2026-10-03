"use client";
/* eslint-disable react-hooks/refs --
   Latest-value refs: timers and SDK callbacks read the newest props and SDK
   handles through refs that are synced during render, the same pattern the
   ElevenLabs React SDK uses internally. */

import { CommitStrategy, ConversationProvider, useConversation, useScribe } from "@elevenlabs/react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  APP_PREFIX,
  HUMAN_SPEAKER_OF,
  PHASE_OF,
  appInstruction,
  cleanAgentText,
  heardUpdate,
  isEmptyUtterance,
  type VoiceMode,
} from "@/lib/voice/protocol";
import {
  registerVoice,
  type VoiceEvent,
  type VoicePanelHandle,
  type VoiceState,
  type VoiceStatus,
} from "@/lib/voice/registry";
import type { Speaker } from "@/lib/types";

export type { VoicePanelHandle, VoiceState, VoiceStatus } from "@/lib/voice/registry";

export type VoicePanelProps = {
  mode: VoiceMode;
  sessionId: string;
  // Large initial context: what was seen so far, the gap list, the Work Map JSON.
  // Read when start() is called.
  context?: string;
  // Handlers for the agent's client tools (mark_gap, teach_back, ...).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientTools?: Record<string, (params: any) => unknown>;
  // "gated": the agent only hears the microphone during question windows and
  // Scribe v2 Realtime transcribes continuously. "open": normal turn-taking.
  // Defaults to gated for the interviewer and open otherwise.
  micPolicy?: "open" | "gated";
  // No microphone, no audio. For testing prompts and client tools by typing.
  textOnly?: boolean;
  // Names used in the agent's prompt. personName is the person speaking
  // (expert, or learner in tutor mode); expertName is only used by the tutor.
  personName?: string;
  expertName?: string;
  task?: string;
  // Debrief and tutor open the conversation themselves once connected.
  autoKickoff?: boolean;
  // Show the Start/Stop buttons. Turn off when the page drives the handle.
  controls?: boolean;
  className?: string;
  ref?: Ref<VoicePanelHandle>;
};

type Line = { id: number; who: "agent" | "person" | "note"; text: string; muted?: boolean };

const LABEL: Record<VoiceMode, string> = { interviewer: "Apprentice", debrief: "Debrief", tutor: "Tutor" };

export function VoicePanel(props: VoicePanelProps) {
  return (
    <ConversationProvider>
      <VoicePanelInner {...props} />
    </ConversationProvider>
  );
}

export default VoicePanel;

function VoicePanelInner({
  mode,
  sessionId,
  context,
  clientTools,
  micPolicy,
  textOnly = false,
  personName,
  expertName,
  task,
  autoKickoff = true,
  controls = true,
  className,
  ref,
}: VoicePanelProps) {
  const policy = micPolicy ?? (mode === "interviewer" ? "gated" : "open");
  const gated = policy === "gated" && !textOnly;
  const phase = PHASE_OF[mode];
  const human = HUMAN_SPEAKER_OF[mode];

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const [lines, setLines] = useState<Line[]>([]);
  const [gateOpen, setGateOpen] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [draft, setDraft] = useState("");

  // Mutable state read by timers and by the handle.
  const live = useRef({
    status: "idle" as VoiceStatus,
    gateOpen: false,
    agentSpeaking: false,
    lastUserSpeechAt: null as number | null,
    lastAgentSpeechAt: null as number | null,
    lastAgentText: "",
    lastSentText: "",
    pendingContext: [] as string[],
    startedAtMs: null as number | null,
    error: undefined as string | undefined,
  });
  const listeners = useRef(new Set<(e: VoiceEvent) => void>());
  const lineId = useRef(0);
  const toolsRef = useRef(clientTools);
  toolsRef.current = clientTools;
  const propsRef = useRef({ context, personName, expertName, task });
  propsRef.current = { context, personName, expertName, task };

  const addLine = useCallback((who: Line["who"], text: string, muted = false) => {
    setLines((prev) => [...prev.slice(-199), { id: ++lineId.current, who, text, muted }]);
  }, []);

  // Session start time, so transcript items carry session-relative times.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && s?.startedAt) live.current.startedAtMs = Date.parse(s.startedAt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const scribeStatusRef = useRef<VoiceState["scribe"]>("off");

  const getState = useCallback(
    (): VoiceState => ({
      status: live.current.status,
      agentSpeaking: live.current.agentSpeaking,
      micOpen: gated ? live.current.gateOpen : true,
      lastUserSpeechAt: live.current.lastUserSpeechAt,
      lastAgentSpeechAt: live.current.lastAgentSpeechAt,
      scribe: scribeStatusRef.current,
      error: live.current.error,
    }),
    [gated],
  );

  const emit = useCallback((event: VoiceEvent) => listeners.current.forEach((l) => l(event)), []);
  const emitState = useCallback(() => emit({ type: "state", state: getState() }), [emit, getState]);

  // Every final utterance goes to the session transcript.
  const record = useCallback(
    (speaker: Speaker, text: string) => {
      const at = Date.now();
      addLine(speaker === "agent" ? "agent" : "person", text);
      const started = live.current.startedAtMs;
      fetch(`/api/sessions/${sessionId}/transcript`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speaker, text, phase, ...(started ? { t: Math.max(0, at - started) } : {}) }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((stored) => {
          const item = Array.isArray(stored) ? stored[0] : stored;
          emit({ type: "utterance", speaker, text, at, transcriptId: item?.id });
        })
        .catch(() => emit({ type: "utterance", speaker, text, at }));
    },
    [addLine, emit, phase, sessionId],
  );

  const conversation = useConversation({
    micMuted: textOnly ? undefined : gated ? !gateOpen : false,
    // Gated: anything the agent says outside a question window is not played.
    // (Text conversations have no audio: setVolume throws there.)
    volume: textOnly ? undefined : gated && !gateOpen ? 0 : 1,
    onConnect: () => {
      live.current.status = "connected";
      setStatus("connected");
      emitState();
    },
    onDisconnect: () => {
      live.current.status = "idle";
      live.current.agentSpeaking = false;
      setStatus("idle");
      setAgentSpeaking(false);
      emitState();
    },
    onError: (message: string) => {
      live.current.error = message;
      setError(message);
      emitState();
    },
    onModeChange: ({ mode: m }) => {
      const speaking = m === "speaking";
      if (live.current.agentSpeaking && !speaking) live.current.lastAgentSpeechAt = Date.now();
      live.current.agentSpeaking = speaking;
      setAgentSpeaking(speaking);
      emitState();
    },
    onVadScore: ({ vadScore }) => {
      // Open policy: the agent's own voice activity score is the speech signal.
      if (!gated && vadScore > 0.6 && !live.current.agentSpeaking) live.current.lastUserSpeechAt = Date.now();
    },
    onMessage: ({ message, role }) => {
      if (role === "agent") {
        const text = cleanAgentText(message);
        if (!text) return;
        live.current.lastAgentText = text;
        live.current.lastAgentSpeechAt = Date.now();
        if (gated && !live.current.gateOpen) {
          // Not asked for and not audible. Shown for debugging, not recorded.
          addLine("agent", text, true);
          return;
        }
        record("agent", text);
        return;
      }
      if (message.startsWith(APP_PREFIX) || isEmptyUtterance(message)) return;
      if (message === live.current.lastSentText) return; // already recorded by sendText
      live.current.lastUserSpeechAt = Date.now();
      // Gated with Scribe running: Scribe is the transcript source, so the
      // agent's own transcription of the same words is dropped.
      if (gated && scribeStatusRef.current !== "off" && scribeStatusRef.current !== "error") return;
      record(human, message.trim());
    },
  });
  const convRef = useRef(conversation);
  convRef.current = conversation;

  const sendContext = useCallback((text: string) => {
    if (!text.trim()) return;
    if (live.current.status === "connected") convRef.current.sendContextualUpdate(text);
    else live.current.pendingContext.push(text);
  }, []);

  // Scribe v2 Realtime: continuous transcript and speech activity while the
  // agent's microphone is muted.
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    vadSilenceThresholdSecs: 1.0,
    onPartialTranscript: ({ text }) => {
      if (!text.trim() || live.current.agentSpeaking) return;
      live.current.lastUserSpeechAt = Date.now();
    },
    onCommittedTranscript: ({ text }) => {
      const said = text.trim();
      if (!said || isEmptyUtterance(said)) return;
      if (soundsLike(said, live.current.lastAgentText)) return; // the agent's own voice through the speakers
      live.current.lastUserSpeechAt = Date.now();
      record(human, said);
      // While the gate is closed the agent did not hear this.
      if (!live.current.gateOpen) sendContext(heardUpdate(said));
    },
  });
  scribeStatusRef.current = gated ? scribe.status : "off";
  const scribeRef = useRef(scribe);
  scribeRef.current = scribe;

  useEffect(() => {
    emitState();
  }, [scribe.status, emitState]);

  const setGate = useCallback(
    (open: boolean) => {
      live.current.gateOpen = open;
      setGateOpen(open);
      emitState();
    },
    [emitState],
  );

  const start = useCallback(async () => {
    if (live.current.status === "connecting" || live.current.status === "connected") return;
    live.current.status = "connecting";
    live.current.error = undefined;
    setStatus("connecting");
    setError(undefined);
    emitState();
    try {
      const res = await fetch(`/api/voice/token?agent=${mode}`);
      const cred = await res.json();
      if (!res.ok) throw new Error(cred.error ?? "Could not get a voice token");

      const p = propsRef.current;
      const dynamicVariables: Record<string, string> = {
        person_name: p.personName || (mode === "tutor" ? "the new hire" : "the expert"),
        session_context: p.context?.trim() || "Nothing yet.",
        ...(mode === "tutor" ? { expert_name: p.expertName || "the expert" } : { task: p.task || "their task" }),
      };
      // Handlers are looked up at call time so the page can change them.
      const tools: Record<string, (params: unknown) => Promise<string>> = {};
      for (const name of Object.keys(toolsRef.current ?? {})) {
        tools[name] = async (params) => {
          addLine("note", `${name}(${JSON.stringify(params)})`);
          const out = await toolsRef.current?.[name]?.(params);
          return typeof out === "string" ? out : "ok";
        };
      }

      convRef.current.startSession({
        ...(textOnly
          ? {
              signedUrl: cred.signedUrl,
              connectionType: "websocket" as const,
              textOnly: true,
              overrides: { conversation: { textOnly: true } },
            }
          : { conversationToken: cred.conversationToken, connectionType: "webrtc" as const }),
        dynamicVariables,
        clientTools: tools,
        onUnhandledClientToolCall: (call: { tool_name: string; parameters: unknown }) =>
          addLine("note", `${call.tool_name}(${JSON.stringify(call.parameters)}) has no handler`),
      });

      if (gated) {
        const tokenRes = await fetch("/api/voice/token?agent=scribe");
        const { token } = await tokenRes.json();
        if (token) {
          await scribeRef.current.connect({
            token,
            microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A Scribe failure leaves the agent connection usable.
      if ((live.current.status as VoiceStatus) !== "connected") {
        live.current.status = "error";
        setStatus("error");
      }
      live.current.error = message;
      setError(message);
      emitState();
    }
  }, [addLine, emitState, gated, mode, textOnly]);

  const stop = useCallback(async () => {
    try {
      scribeRef.current.disconnect();
    } catch {}
    convRef.current.endSession();
    setGate(false);
  }, [setGate]);

  const speak = useCallback(
    (instruction: string) => {
      if (live.current.status !== "connected") return;
      if (gated) setGate(true);
      convRef.current.sendUserMessage(appInstruction(instruction));
    },
    [gated, setGate],
  );

  const sendText = useCallback(
    (text: string) => {
      const said = text.trim();
      if (!said || live.current.status !== "connected") return;
      live.current.lastSentText = said;
      live.current.lastUserSpeechAt = Date.now();
      record(human, said);
      convRef.current.sendUserMessage(said);
    },
    [human, record],
  );

  // Once connected: flush queued context, then let debrief and tutor open.
  useEffect(() => {
    if (status !== "connected") return;
    const queued = live.current.pendingContext.splice(0);
    queued.forEach((text) => convRef.current.sendContextualUpdate(text));
    if (mode !== "interviewer" && autoKickoff) {
      const timer = setTimeout(() => convRef.current.sendUserMessage(appInstruction("Start")), 400);
      return () => clearTimeout(timer);
    }
  }, [status, mode, autoKickoff]);

  const handle = useMemo<VoicePanelHandle>(
    () => ({
      start,
      stop,
      sendContext,
      speak,
      sendText,
      openMic: () => setGate(true),
      closeMic: () => setGate(false),
      getState,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      get status() {
        return live.current.status;
      },
    }),
    [start, stop, sendContext, speak, sendText, setGate, getState],
  );
  useImperativeHandle(ref, () => handle, [handle]);
  useEffect(() => registerVoice(sessionId, handle), [sessionId, handle]);

  // End the session when the panel goes away.
  useEffect(
    () => () => {
      try {
        scribeRef.current.disconnect();
      } catch {}
      convRef.current.endSession();
    },
    [],
  );

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines, scribe.partialTranscript]);

  const connected = status === "connected";
  const activity = !connected
    ? status === "connecting"
      ? "Connecting"
      : status === "error"
        ? "Error"
        : "Not connected"
    : agentSpeaking
      ? `${LABEL[mode]} is speaking`
      : textOnly
        ? "Text only"
        : gated
          ? gateOpen
            ? "Listening for your answer"
            : "Quiet while you work"
          : "Listening";
  const dot = !connected
    ? status === "error"
      ? "bg-red-500"
      : "bg-zinc-400"
    : agentSpeaking
      ? "bg-indigo-500 animate-pulse"
      : gated && !gateOpen
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <section
      className={`flex min-h-0 flex-col rounded-lg border border-zinc-200 bg-white text-sm text-zinc-900 ${className ?? ""}`}
      data-voice-status={status}
    >
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{LABEL[mode]}</div>
          <div className="truncate text-xs text-zinc-500" aria-live="polite">
            {activity}
            {gated && connected ? ` · transcript: ${scribe.status}` : ""}
          </div>
        </div>
        {controls &&
          (connected || status === "connecting" ? (
            <button type="button" onClick={stop} className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
              Stop
            </button>
          ) : (
            <button type="button" onClick={start} className="rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700">
              Start
            </button>
          ))}
      </header>

      {error && <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</div>}

      <div ref={scroller} className="min-h-24 flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {lines.length === 0 && <p className="text-xs text-zinc-400">Nothing said yet.</p>}
        {lines.map((line) =>
          line.who === "note" ? (
            <p key={line.id} className="break-words font-mono text-[11px] text-zinc-400">
              {line.text}
            </p>
          ) : (
            <p key={line.id} className={line.muted ? "text-zinc-400 line-through" : ""}>
              <span className={`mr-1.5 text-xs font-medium ${line.who === "agent" ? "text-indigo-600" : "text-zinc-500"}`}>
                {line.who === "agent" ? LABEL[mode] : personName || (human === "learner" ? "Learner" : "Expert")}
              </span>
              {line.text}
            </p>
          ),
        )}
        {gated && scribe.partialTranscript && <p className="text-zinc-400">{scribe.partialTranscript}</p>}
      </div>

      {textOnly && (
        <form
          className="flex gap-2 border-t border-zinc-200 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendText(draft);
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={connected ? "Type what you would say" : "Start the session first"}
            disabled={!connected}
            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100"
          />
          <button type="submit" disabled={!connected} className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40">
            Send
          </button>
        </form>
      )}
    </section>
  );
}

// True when `heard` is mostly made of the words in `spoken`: the microphone
// picked up the agent's own voice.
function soundsLike(heard: string, spoken: string) {
  if (!spoken) return false;
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  const a = words(heard);
  const b = new Set(words(spoken));
  if (a.length < 3) return false;
  return a.filter((w) => b.has(w)).length / a.length > 0.7;
}
