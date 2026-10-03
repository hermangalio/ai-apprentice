"use client";

import { useEffect, useState } from "react";
import { CaptureControls } from "@/components/capture/CaptureControls";
import { EventFeed } from "@/components/capture/EventFeed";
import { ERP_CHANNEL, useScreenCapture } from "@/lib/capture/useScreenCapture";
import type { ScreenEvent, Session } from "@/lib/types";

// Test page for the capture module: create a session, share a screen, watch events.
export default function DevCapturePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [personName, setPersonName] = useState("Sabine");
  const [task, setTask] = useState("Process supplier invoices");
  const [log, setLog] = useState<string[]>([]);
  const [selected, setSelected] = useState<ScreenEvent | null>(null);
  const [now, setNow] = useState(0);
  const capture = useScreenCapture({ sessionId: session?.id });

  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, []);

  const note = (line: string) => setLog((l) => [...l.slice(-7), line]);

  const createSession = async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "expert", personName, task }),
    });
    if (!res.ok) return note(`Create failed: ${res.status}`);
    setSession(await res.json());
  };

  // Posts fixture frames 02-04 through the real frames route, without screen sharing.
  const replayFixture = async () => {
    if (!session) return;
    for (const [frameId, t] of [["frm_02", 31000], ["frm_03", 58000], ["frm_04", 192000]] as const) {
      const jpeg = await fetch(`/api/sessions/fixture_sabine/frames/${frameId}`).then((r) => r.blob());
      const started = performance.now();
      const res = await fetch(`/api/sessions/${session.id}/frames?t=${t}`, {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: jpeg,
      });
      const events: ScreenEvent[] = res.ok ? await res.json() : [];
      note(`${frameId}: ${Math.round(performance.now() - started)} ms, ${events.map((e) => e.summary).join(" | ") || "no events"}`);
    }
  };

  // Stands in for the sandbox ERP: posts on the same BroadcastChannel.
  const sendDom = (typing: boolean) => {
    const ch = new BroadcastChannel(ERP_CHANNEL);
    ch.postMessage(
      typing
        ? { kind: "other", summary: "typing", source: "dom", wallTime: Date.now() }
        : {
            kind: "field_change",
            summary: "Cost center changed from 4711 to 0400",
            entity: { type: "invoice", id: "4471" },
            field: "cost_center",
            before: "4711",
            after: "0400",
            committed: false,
            facts: { invoice_id: "4471", amount: 6840, category: "equipment", cost_center: "0400" },
            source: "dom",
            wallTime: Date.now(),
          },
    );
    ch.close();
  };

  const idleMs = capture.lastActivityAt && now ? Math.max(0, now - capture.lastActivityAt) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 bg-white p-6 text-zinc-900">
      <h1 className="text-xl font-semibold">Capture test page</h1>

      {!session ? (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col">
            Name
            <input className="rounded border border-zinc-300 px-2 py-1" value={personName} onChange={(e) => setPersonName(e.target.value)} />
          </label>
          <label className="flex flex-1 flex-col">
            Task
            <input className="rounded border border-zinc-300 px-2 py-1" value={task} onChange={(e) => setTask(e.target.value)} />
          </label>
          <button type="button" onClick={() => void createSession()} className="rounded bg-zinc-900 px-3 py-1 text-white">
            Create session
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-600">
            Session <code>{session.id}</code>, started {session.startedAt}
          </p>
          <CaptureControls capture={capture} />
          <dl className="grid grid-cols-4 gap-2 text-sm">
            <div><dt className="text-zinc-500">Status</dt><dd data-testid="status">{capture.status}</dd></div>
            <div><dt className="text-zinc-500">Paused</dt><dd data-testid="paused">{String(capture.paused)}</dd></div>
            <div><dt className="text-zinc-500">Frames sent</dt><dd>{capture.framesSent}</dd></div>
            <div>
              <dt className="text-zinc-500">Idle for</dt>
              <dd data-testid="idle">{idleMs === null ? "no activity yet" : `${(idleMs / 1000).toFixed(1)} s`}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" onClick={() => sendDom(false)} className="rounded border border-zinc-300 px-3 py-1">
              Send test DOM event
            </button>
            <button type="button" onClick={() => sendDom(true)} className="rounded border border-zinc-300 px-3 py-1">
              Send typing ping
            </button>
            <button type="button" onClick={() => void replayFixture()} className="rounded border border-zinc-300 px-3 py-1">
              Replay fixture frames 02-04
            </button>
          </div>
          <section>
            <h2 className="mb-1 text-sm font-semibold">Events ({capture.events.length})</h2>
            <EventFeed events={capture.events} onSelect={setSelected} className="max-h-72 rounded border border-zinc-200 p-1" />
          </section>
          {selected && (
            <section className="flex gap-3 text-xs">
              {selected.frameId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/sessions/${session.id}/frames/${selected.frameId}`} alt="Frame for the selected event" className="w-64 rounded border border-zinc-200" />
              )}
              <pre className="flex-1 overflow-auto rounded bg-zinc-100 p-2">{JSON.stringify(selected, null, 2)}</pre>
            </section>
          )}
          {log.length > 0 && <pre className="overflow-auto rounded bg-zinc-100 p-2 text-xs">{log.join("\n")}</pre>}
        </>
      )}
    </main>
  );
}
