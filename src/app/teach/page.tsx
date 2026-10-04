"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageWaves } from "@/components/PageWaves";
import type { WorkMapSummary } from "@/app/api/workmaps/route";
import type { Session, WorkMap } from "@/lib/types";

// useSearchParams needs a boundary so the rest of the page can still be
// prerendered.
export default function TeachStartPage() {
  return (
    <Suspense fallback={null}>
      <TeachStart />
    </Suspense>
  );
}

// Start a tutoring session: pick whose Work Map to learn from, see what the
// practice covers, then open the sandbox and begin.
function TeachStart() {
  const router = useRouter();
  // "Teach this" on a work map arrives with that map preselected.
  const wanted = useSearchParams().get("map");
  const [maps, setMaps] = useState<WorkMapSummary[] | null>(null);
  const [expertId, setExpertId] = useState("");
  const [name, setName] = useState("Lena");
  // Tagged with the map it belongs to, so a stale answer is simply ignored and
  // the effect never has to clear it synchronously.
  const [loaded, setLoaded] = useState<{ id: string; map: WorkMap | null } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workmaps", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<WorkMapSummary[]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows) => {
        if (cancelled) return;
        const ready = rows.filter((r) => r.status === "confirmed");
        setMaps(ready);
        setExpertId(ready.find((r) => r.sessionId === wanted)?.sessionId ?? ready[0]?.sessionId ?? "");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  // The steps of the chosen map, for "What you'll practice".
  useEffect(() => {
    if (!expertId) return;
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(expertId)}/workmap`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<WorkMap>) : null))
      .catch(() => null)
      .then((map) => !cancelled && setLoaded({ id: expertId, map }));
    return () => {
      cancelled = true;
    };
  }, [expertId]);

  const preview = loaded?.id === expertId ? loaded.map : null;

  const chosen = useMemo(() => maps?.find((m) => m.sessionId === expertId) ?? null, [maps, expertId]);

  const start = async () => {
    if (!chosen) return;
    setStarting(true);
    setError(null);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "learner", personName: name, task: chosen.task, workMapSessionId: chosen.sessionId }),
    });
    if (!res.ok) {
      setStarting(false);
      return setError(`Could not create the session (${res.status})`);
    }
    const session: Session = await res.json();
    // The learner works in the sandbox; the tutor watches it from the panel.
    window.open("/hiring?set=learner", "_blank", "noreferrer");
    router.push(`/teach/${session.id}`);
  };

  // What the practice covers: the judgment calls first, they are the point.
  const practice = useMemo(() => {
    const steps = [...(preview?.steps ?? [])].sort((a, b) => a.index - b.index);
    const judgment = steps.filter((s) => s.isJudgmentCall);
    return (judgment.length >= 3 ? judgment : steps).slice(0, 4);
  }, [preview]);

  return (
    <main className="relative flex-1 px-5 pb-24 pt-10">
      <PageWaves />
      <div className="mx-auto w-full max-w-4xl">
        <Link href="/map" className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M9.5 3.5 5 8l4.5 4.5M5 8h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to work maps
        </Link>

        <p className="mt-6 text-[17px] text-stone-500">Guided practice</p>
        <h1 className="mt-1 text-[40px] font-extrabold leading-tight tracking-tight text-stone-900">
          {chosen?.task ?? "Learn a workflow"}
        </h1>
        <p className="mt-2 text-[19px] text-stone-500">
          Work a case you have not seen. The tutor steps in before a guardrail is broken.
        </p>

        {maps !== null && maps.length === 0 ? (
          <div className="mt-10 rounded-xl border border-stone-200 bg-white px-8 py-12 text-center">
            <p className="text-[19px] font-semibold text-stone-900">No work map is ready yet.</p>
            <p className="mx-auto mt-2 max-w-md text-[17px] text-stone-500">
              A map can be practised once the expert has run the debrief and confirmed it.
            </p>
            <Link
              href="/capture"
              className="mt-6 inline-flex rounded-lg bg-indigo-600 px-6 py-3 text-[17px] font-semibold text-white hover:bg-indigo-700"
            >
              Capture a session
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-8 grid gap-0 overflow-hidden rounded-xl border border-stone-200 bg-white md:grid-cols-[minmax(0,1fr)_320px]">
              <div className="px-8 py-7">
                <h2 className="text-[21px] font-bold tracking-tight text-stone-900">What you&apos;ll practice</h2>
                <ul className="mt-4 space-y-3">
                  {practice.length === 0 && <li className="text-[17px] text-stone-400">Loading the work map…</li>}
                  {practice.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 text-[17px] text-stone-700">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-stone-400" />
                      {s.title}
                    </li>
                  ))}
                </ul>
              </div>

              <dl className="border-stone-100 px-8 py-7 md:border-l">
                <Fact icon={<StepsIcon />} label={`${chosen?.steps ?? 0} step${chosen?.steps === 1 ? "" : "s"}`} />
                <Fact icon={<ShieldIcon />} label={`${preview?.guardrails.length ?? 0} guardrails to respect`} />
                <Fact icon={<PersonIcon />} label={`Created by ${chosen?.expertName ?? "—"}`} last />
              </dl>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-stone-900">
                Your name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-lg border border-stone-200 px-4 py-3 text-[17px] font-normal text-stone-900"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-stone-900">
                Work map to learn from
                <select
                  value={expertId}
                  onChange={(e) => setExpertId(e.target.value)}
                  className="rounded-lg border border-stone-200 px-4 py-3 text-[17px] font-normal text-stone-900"
                >
                  {(maps ?? []).map((m) => (
                    <option key={m.sessionId} value={m.sessionId}>
                      {m.expertName}: {m.task}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-8 flex flex-col items-center">
              <button
                type="button"
                disabled={!expertId || !name.trim() || starting}
                onClick={() => void start()}
                className="rounded-lg bg-indigo-600 px-10 py-4 text-[17px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
              >
                {starting ? "Opening the sandbox…" : "Open the sandbox & begin"}
              </button>
              <p className="mt-4 max-w-lg text-center text-[15px] text-stone-500">
                The sandbox opens in a second window. Put it next to this one: you work there, and the tutor watches from
                here and speaks up only when needed.
              </p>
            </div>
          </>
        )}
        {error && <p className="mt-6 text-center text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}

function Fact({ icon, label, last }: { icon: React.ReactNode; label: string; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3.5 py-3.5 ${last ? "" : "border-b border-stone-100"}`}>
      <span className="text-stone-400">{icon}</span>
      <span className="text-[17px] text-stone-700">{label}</span>
    </div>
  );
}

function StepsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3" y="2.5" width="14" height="15" rx="2" />
      <path d="M6.5 7h7M6.5 10h7M6.5 13h4" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M10 2.5 16.5 5v5c0 4-3 6.6-6.5 8-3.5-1.4-6.5-4-6.5-8V5L10 2.5Z" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M4 16.5c0-3 2.7-4.6 6-4.6s6 1.6 6 4.6" strokeLinecap="round" />
    </svg>
  );
}
