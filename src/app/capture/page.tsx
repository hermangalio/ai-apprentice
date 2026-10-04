"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CaptureControls } from "@/components/capture/CaptureControls";
import { EventFeed } from "@/components/capture/EventFeed";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { useScreenCapture } from "@/lib/capture/useScreenCapture";
import { useInterviewer } from "@/lib/voice/useInterviewer";
import type { VoicePanelHandle } from "@/lib/voice/registry";
import type { Session } from "@/lib/types";

// Module 1. The expert shares their screen and works; the apprentice watches,
// stays quiet, and asks at pauses. Finishing the task builds the draft Work
// Map and moves on to the debrief.
export default function CapturePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [personName, setPersonName] = useState("Emilie");
  const [task, setTask] = useState("Screen applications for the ML engineer role");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "expert", personName, task }),
    });
    if (!res.ok) return setError(`Could not create the session (${res.status})`);
    setSession(await res.json());
  };

  if (session) return <CaptureSession session={session} />;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 p-8 text-stone-900">
      <h1 className="text-2xl font-semibold">Show the apprentice how you work</h1>
      <p className="text-stone-600">
        Share your screen and do a real task. Sharing starts everything: the apprentice watches, listens, stays quiet while you work and asks a short question when you pause.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Your name
        <input className="rounded border border-stone-300 px-3 py-2 text-base" value={personName} onChange={(e) => setPersonName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        The task you will do
        <input className="rounded border border-stone-300 px-3 py-2 text-base" value={task} onChange={(e) => setTask(e.target.value)} />
      </label>
      <div className="flex gap-3">
        <button type="button" disabled={!personName || !task} onClick={() => void create()} className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-40">
          Start session
        </button>
        <a href="/hiring?set=expert" target="_blank" rel="noreferrer" className="rounded border border-stone-300 px-4 py-2">
          Open the hiring desk sandbox
        </a>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </main>
  );
}

const PHASE_LABEL: Record<string, string> = {
  off: "Not started. Share your screen to begin.",
  watching: "Watching quietly",
  choosing: "Pause noticed, choosing a question",
  asking: "Asking",
  listening: "Listening to the answer",
};

function CaptureSession({ session }: { session: Session }) {
  const router = useRouter();
  const voice = useRef<VoicePanelHandle>(null);
  const capture = useScreenCapture({ sessionId: session.id });
  const [finishing, setFinishing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const interviewer = useInterviewer({
    sessionId: session.id,
    lastActivityAt: capture.lastActivityAt || null,
    events: capture.events,
    voice,
    // Questions are about what is on screen, so none are asked before the
    // screen is shared or after sharing has stopped.
    enabled: capture.status === "sharing" && !capture.paused && !finishing,
  });

  // One control for everything: sharing the screen also connects the
  // apprentice (microphone and voice), and stopping the share disconnects it.
  const sharing = capture.status === "sharing";
  useEffect(() => {
    if (sharing) void voice.current?.start();
    else voice.current?.stop();
  }, [sharing]);

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

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6 text-stone-900">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {session.personName}: {session.task}
        </h1>
        <a href="/hiring?set=expert" target="_blank" rel="noreferrer" className="text-sm underline">
          Open the hiring desk sandbox
        </a>
      </header>

      <CaptureControls capture={capture} />

      <section className="rounded-lg border border-stone-200 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">{PHASE_LABEL[interviewer.phase] ?? interviewer.phase}</span>
          <span className="text-stone-500">
            {interviewer.asked.length} question{interviewer.asked.length === 1 ? "" : "s"} asked
            {interviewer.blockedBy.length > 0 && interviewer.phase === "watching" ? `, waiting: ${interviewer.blockedBy.join(", ")}` : ""}
          </span>
        </div>
        <VoicePanel
          ref={voice}
          mode="interviewer"
          sessionId={session.id}
          personName={session.personName}
          task={session.task}
          paused={capture.paused}
          controls={false}
        />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">What the apprentice saw ({capture.events.length})</h2>
        <EventFeed events={capture.events} className="max-h-64 rounded border border-stone-200 p-1" />
      </section>

      <div className="flex items-center gap-3">
        <button type="button" disabled={!!finishing} onClick={() => void finish()} className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-40">
          Task done, start the debrief
        </button>
        {finishing && <span className="text-sm text-stone-600">{finishing}</span>}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </main>
  );
}
