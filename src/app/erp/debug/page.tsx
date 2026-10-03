"use client";

// Debug view: prints every event the ERP posts and can send control messages.
// Open /erp in another tab of the same browser.

import { useEffect, useRef, useState } from "react";
import { ERP_CHANNEL, ERP_CONTROL, ERP_HIGHLIGHT_FIELDS, type ErpControlMessage, type ErpDomEvent } from "@/lib/erp/events";

export default function ErpDebugPage() {
  const [events, setEvents] = useState<ErpDomEvent[]>([]);
  const [showTyping, setShowTyping] = useState(true);
  const [invoiceId, setInvoiceId] = useState("4471");
  const control = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(ERP_CHANNEL);
    ch.onmessage = (e: MessageEvent<ErpDomEvent>) => setEvents((prev) => [e.data, ...prev].slice(0, 300));
    control.current = new BroadcastChannel(ERP_CONTROL);
    return () => {
      ch.close();
      control.current?.close();
      control.current = null;
    };
  }, []);

  const send = (msg: ErpControlMessage) => control.current?.postMessage(msg);
  const shown = showTyping ? events : events.filter((e) => e.summary !== "typing");

  return (
    <main className="mx-auto w-full max-w-6xl p-6">
      <h1 className="text-2xl font-bold">ERP event stream (debug)</h1>
      <p className="mt-1 text-base">
        Channel &quot;{ERP_CHANNEL}&quot;, newest first. Open{" "}
        <a className="underline" href="/erp?set=expert" target="_blank">
          /erp?set=expert
        </a>{" "}
        or{" "}
        <a className="underline" href="/erp?set=learner" target="_blank">
          /erp?set=learner
        </a>{" "}
        in another tab.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded border-2 border-slate-300 bg-white p-3">
        <span className="font-semibold">Highlight:</span>
        {ERP_HIGHLIGHT_FIELDS.map((f) => (
          <button key={f} type="button" className="rounded border border-slate-900 px-2 py-1 text-sm" onClick={() => send({ type: "highlight", field: f })}>
            {f}
          </button>
        ))}
        <span className="ml-4 font-semibold">Open invoice:</span>
        <input className="w-24 rounded border border-slate-900 px-2 py-1" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
        <button type="button" className="rounded bg-slate-900 px-3 py-1 text-white" onClick={() => send({ type: "open_invoice", id: invoiceId })}>
          Send
        </button>
        <label className="ml-4 flex items-center gap-2">
          <input type="checkbox" checked={showTyping} onChange={(e) => setShowTyping(e.target.checked)} />
          Show typing pings
        </label>
        <button type="button" className="ml-auto rounded border border-slate-900 px-3 py-1" onClick={() => setEvents([])}>
          Clear
        </button>
      </div>

      <div className="mt-4 text-base font-semibold" data-testid="event-count">
        {shown.length} events
      </div>
      <ol className="mt-2 flex flex-col gap-2">
        {shown.map((e, i) => (
          <li key={`${e.wallTime}-${i}`} className="rounded border border-slate-300 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-sm text-slate-600">{new Date(e.wallTime).toLocaleTimeString()}</span>
              <span className="rounded bg-slate-900 px-2 py-0.5 text-sm font-bold text-white">{e.kind}</span>
              <span className="text-lg font-semibold">{e.summary}</span>
              {e.committed !== undefined && (
                <span className={`text-sm font-bold ${e.committed ? "text-green-800" : "text-amber-700"}`}>
                  {e.committed ? "committed" : "not committed"}
                </span>
              )}
            </div>
            <pre className="mt-1 overflow-x-auto text-xs text-slate-700">{JSON.stringify(e)}</pre>
          </li>
        ))}
      </ol>
    </main>
  );
}
