"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { PageWaves } from "@/components/PageWaves";
import { EventFeed } from "@/components/capture/EventFeed";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { useScreenCapture } from "@/lib/capture/useScreenCapture";
import { DEFAULT_PERSON_NAME, usePersonName, writePersonName } from "@/lib/profile";
import { useInterviewer } from "@/lib/voice/useInterviewer";
import type { VoicePanelHandle, VoiceState } from "@/lib/voice/registry";
import type { Session } from "@/lib/types";

// Module 1. The expert shares their screen and works; the apprentice watches,
// stays quiet, and asks at pauses. Finishing the task builds the draft Work
// Map and moves on to the debrief.
export default function CapturePage() {
  const [session, setSession] = useState<Session | null>(null);
  // The name is remembered per browser, so the top bar and this screen agree.
  // `edited` holds what was typed here and wins until the page is left.
  const stored = usePersonName();
  const [edited, setEdited] = useState<string | null>(null);
  const personName = edited ?? stored ?? DEFAULT_PERSON_NAME;
  const [task, setTask] = useState("Screen applications for the ML engineer role");
  const [language, setLanguage] = useState("en");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    writePersonName(personName);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "expert", personName, task }),
    });
    if (!res.ok) return setError(`Could not create the session (${res.status})`);
    setSession(await res.json());
  };

  if (session) return <CaptureSession session={session} language={language} />;

  return (
    <main className="relative flex-1 px-5 pb-20 pt-8">
      <PageWaves />
      <div className="mx-auto w-full max-w-5xl">
        <Link
          href="/map"
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <ArrowLeft /> Work maps
        </Link>
        <h1 className="mt-3 text-[44px] font-extrabold leading-tight tracking-tight text-stone-900">Capture session</h1>
      </div>

      <div className="mx-auto mt-14 w-full max-w-[815px] rounded-xl border border-stone-200 bg-white px-16 py-12 shadow-[0_1px_2px_rgba(10,37,64,0.04)]">
        <h2 className="text-[28px] font-extrabold tracking-tight text-stone-900">What will you show the apprentice?</h2>
        <p className="mt-2 text-[17px] text-stone-500">Choose a task you can demonstrate on your screen.</p>

        <div className="mt-9">
          <label htmlFor="task" className="block text-sm font-semibold text-stone-900">
            Task name
          </label>
          <input
            id="task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            className="mt-2 w-full rounded-lg border border-stone-200 px-4 py-3 text-[17px] text-stone-900 placeholder:text-stone-400"
            placeholder="Prepare a project handover"
          />
        </div>

        <div className="mt-7">
          <label htmlFor="language" className="block text-sm font-semibold text-stone-900">
            Language you will speak
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-2 w-full rounded-lg border border-stone-200 px-4 py-3 text-[17px] text-stone-900"
          >
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="auto">Auto-detect (less reliable)</option>
          </select>
        </div>

        <div className="mt-7">
          <span className="block text-sm font-semibold text-stone-900">Expert</span>
          <ExpertRow name={personName} onChange={setEdited} />
        </div>

        <button
          type="button"
          disabled={!personName.trim() || !task.trim()}
          onClick={() => void create()}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg bg-indigo-600 px-6 py-4 text-[17px] font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-40"
        >
          <MonitorIcon /> Choose screen
        </button>
        <p className="mt-4 text-center text-[15px] text-stone-500">You&apos;ll preview your screen before recording starts.</p>
        {error && <p className="mt-4 text-center text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}

// The expert's name: a read-only row with an Edit link, as in the design.
function ExpertRow({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  return (
    <div className="mt-2 flex items-center gap-4 rounded-lg border border-stone-200 px-4 py-3.5">
      <Avatar name={name} size={40} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={input}
            value={name}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditing(false);
            }}
            aria-label="Your name"
            className="w-full rounded-md border border-stone-200 px-2 py-1 text-[17px] font-semibold text-stone-900"
          />
        ) : (
          <>
            <p className="truncate text-[17px] font-semibold leading-tight text-stone-900">{name || "Unnamed"}</p>
            <p className="text-[15px] leading-tight text-stone-500">You</p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="shrink-0 text-[17px] font-medium text-indigo-600 hover:text-indigo-700"
      >
        {editing ? "Done" : "Edit"}
      </button>
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  off: "Waiting to start",
  watching: "Watching quietly",
  choosing: "Choosing a question",
  asking: "Asking",
  listening: "Listening to the answer",
};

function CaptureSession({ session, language }: { session: Session; language: string }) {
  const router = useRouter();
  const voice = useRef<VoicePanelHandle>(null);
  const capture = useScreenCapture({ sessionId: session.id });
  const [finishing, setFinishing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState | null>(null);

  const sharing = capture.status === "sharing";
  const recording = sharing && !capture.paused;

  const interviewer = useInterviewer({
    sessionId: session.id,
    lastActivityAt: capture.lastActivityAt || null,
    events: capture.events,
    voice,
    // Questions are about what is on screen, so none are asked before the
    // screen is shared or after sharing has stopped.
    enabled: sharing && !capture.paused && !finishing,
  });

  // One control for everything: sharing the screen also connects the
  // apprentice (microphone and voice), and stopping the share disconnects it.
  useEffect(() => {
    if (sharing) void voice.current?.start();
    else voice.current?.stop();
  }, [sharing]);

  // Follow the voice connection so the card header can report it.
  useEffect(() => {
    const handle = voice.current;
    if (!handle) return;
    setVoiceState(handle.getState());
    return handle.subscribe((event) => {
      if (event.type === "state") setVoiceState(event.state);
    });
  }, []);

  // The voice connection can drop while the screen is still shared (network
  // blip, tab throttling). Reconnect a few times instead of staying silent.
  useEffect(() => {
    const handle = voice.current;
    if (!sharing || finishing || !handle) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = handle.subscribe((event) => {
      if (event.type !== "state") return;
      if (event.state.status === "connected") {
        tries = 0;
        return;
      }
      if ((event.state.status === "idle" || event.state.status === "error") && tries < 3) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          tries += 1;
          void handle.start();
        }, 1500 * (tries + 1));
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [sharing, finishing]);

  const elapsed = useElapsed(sharing);

  const finish = async () => {
    setError(null);
    setFinishing("Closing the session");
    capture.stop();
    voice.current?.stop();
    await fetch(`/api/sessions/${session.id}/end`, { method: "POST" });
    setFinishing("Building the draft Work Map (about 15 seconds)");
    const res = await fetch(`/api/sessions/${session.id}/workmap`, { method: "POST" });
    if (!res.ok) {
      setFinishing(null);
      return setError(`Could not build the Work Map (${res.status}): ${await res.text()}`);
    }
    router.push(`/map/${session.id}`);
  };

  const connected = voiceState?.status === "connected";
  const voiceLabel = !sharing
    ? "Not connected"
    : connected
      ? (PHASE_LABEL[interviewer.phase] ?? interviewer.phase)
      : "Reconnecting voice…";
  const voiceDot = !sharing ? "bg-stone-300" : connected ? "bg-emerald-500" : "bg-amber-400";

  return (
    <main className="relative flex-1 px-5 pb-20 pt-8">
      <PageWaves />
      <div className="mx-auto w-full max-w-[880px]">
        <button
          type="button"
          onClick={() => router.push("/capture")}
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <ArrowLeft /> Back
        </button>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[40px] font-extrabold leading-tight tracking-tight text-stone-900">{session.task}</h1>
            <p className="mt-1 text-[17px] text-stone-500">{session.personName}</p>
          </div>
          {/* The expert needs the sandbox to do the task in. */}
          <a
            href="/hiring?set=expert"
            target="_blank"
            rel="noreferrer"
            className="text-[15px] font-medium text-indigo-600 hover:text-indigo-700"
          >
            Open the hiring desk sandbox
          </a>
        </div>

        {/* Recording status */}
        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(10,37,64,0.04)]">
          <span role="status" aria-live="polite" className="flex items-center gap-3 text-[17px] text-stone-900">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${
                recording ? "animate-pulse bg-red-500" : capture.paused ? "bg-amber-400" : "bg-stone-300"
              }`}
            />
            {recording
              ? `Screen recording · ${elapsed}`
              : capture.paused
                ? `Paused · ${elapsed}`
                : capture.status === "requesting"
                  ? "Waiting for screen selection"
                  : "Not recording"}
          </span>
          {sharing && (
            <button type="button" onClick={capture.stop} className="text-[17px] font-medium text-indigo-600 hover:text-indigo-700">
              Stop sharing
            </button>
          )}
        </div>

        {/* The apprentice */}
        <section className="mt-5 rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(10,37,64,0.04)]">
          <header className="flex flex-wrap items-center gap-3 px-5 py-4">
            <h2 className="text-[19px] font-bold tracking-tight text-stone-900">Apprentice</h2>
            <span className="flex items-center gap-2 text-[15px] text-stone-500" aria-live="polite">
              <span className={`h-2.5 w-2.5 rounded-full ${voiceDot}`} />
              {voiceLabel}
            </span>
            {sharing && interviewer.asked.length > 0 && (
              <span className="ml-auto text-[15px] text-stone-400">
                {interviewer.asked.length} question{interviewer.asked.length === 1 ? "" : "s"} asked
              </span>
            )}
          </header>

          <div className="flex min-h-[300px] flex-col border-y border-stone-200 px-5 py-5">
            <VoicePanel
              ref={voice}
              mode="interviewer"
              sessionId={session.id}
              personName={session.personName}
              task={session.task}
              language={language}
              paused={capture.paused}
              controls={false}
              chrome="bare"
              className="flex-1"
              emptyState={
                <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-6 text-center">
                  {!sharing ? (
                    <>
                      <p className="text-[21px] font-bold tracking-tight text-stone-900">Ready when you are.</p>
                      <p className="mt-2 max-w-sm text-[17px] text-stone-500">
                        Sharing your screen starts the recording and connects the apprentice.
                      </p>
                      <button
                        type="button"
                        onClick={() => void capture.start()}
                        disabled={capture.status === "requesting"}
                        className="mt-6 inline-flex items-center justify-center gap-3 rounded-lg bg-indigo-600 px-7 py-3.5 text-[17px] font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <MonitorIcon />
                        {capture.status === "requesting" ? "Waiting for your screen…" : "Share screen & start"}
                      </button>
                      {capture.error && capture.status === "error" && (
                        <p className="mt-4 text-sm text-red-700">{capture.error}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-[21px] font-bold tracking-tight text-stone-900">Your screen is still being recorded.</p>
                      <p className="mt-2 text-[17px] text-stone-500">
                        {connected ? "The apprentice is watching and will ask when you pause." : "Voice questions will resume when connected."}
                      </p>
                    </>
                  )}
                </div>
              }
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            {sharing ? (
              <button
                type="button"
                onClick={() => capture.setPaused(!capture.paused)}
                aria-pressed={capture.paused}
                className="inline-flex items-center gap-2.5 rounded-lg border border-stone-300 bg-white px-5 py-3 text-[17px] font-medium text-stone-900 hover:bg-stone-50"
              >
                {capture.paused ? <PlayIcon /> : <PauseIcon />}
                {capture.paused ? "Resume" : "Pause"}
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {finishing && <span className="text-[15px] text-stone-500">{finishing}</span>}
              <button
                type="button"
                disabled={!!finishing}
                onClick={() => void finish()}
                className="inline-flex items-center gap-2.5 rounded-lg bg-indigo-600 px-6 py-3 text-[17px] font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Finish session <ArrowRight />
              </button>
            </div>
          </div>
        </section>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

        {/* Session activity */}
        <details className="group mt-5 rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(10,37,64,0.04)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 text-[17px] font-medium text-stone-900">
            <ChevronRight />
            Session activity
            {capture.events.length > 0 && <span className="text-stone-400">({capture.events.length})</span>}
          </summary>
          <EventFeed events={capture.events} className="mt-4 max-h-72" />
        </details>
      </div>
    </main>
  );
}

// MM:SS since sharing started. The clock restarts whenever `running` turns
// true, because the effect captures a fresh start time.
function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(timer);
  }, [running]);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function MonitorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="2" y="3.5" width="16" height="11" rx="1.6" />
      <path d="M7 17.5h6" strokeLinecap="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="3.6" height="11" rx="1" />
      <rect x="9.4" y="2.5" width="3.6" height="11" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.6v10.8a.6.6 0 0 0 .92.5l8.4-5.4a.6.6 0 0 0 0-1L4.92 2.1a.6.6 0 0 0-.92.5Z" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M9.5 3.5 5 8l4.5 4.5M5 8h7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6.5 3.5 11 8l-4.5 4.5M11 8H4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="shrink-0 text-stone-500 transition-transform group-open:rotate-90"
      aria-hidden
    >
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
