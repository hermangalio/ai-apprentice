"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@/lib/types";

// Start a tutoring session: pick whose Work Map to learn from.
export default function TeachStartPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<Session[]>([]);
  const [expertId, setExpertId] = useState("");
  const [name, setName] = useState("Lena");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const all: Session[] = await fetch("/api/sessions").then((r) => r.json());
      const withMaps: Session[] = [];
      // Sessions written by test scripts are not offered.
      const isTest = (x: Session) => x.task.startsWith("[test]") || x.id.startsWith("maptest_");
      for (const s of all.filter((x) => x.role === "expert" && !isTest(x))) {
        const res = await fetch(`/api/sessions/${s.id}/workmap`);
        if (res.ok && (await res.json()).status === "confirmed") withMaps.push(s);
      }
      withMaps.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      setExperts(withMaps);
      setExpertId(withMaps[0]?.id ?? "");
    })().catch((e) => setError(String(e)));
  }, []);

  const start = async () => {
    const expert = experts.find((e) => e.id === expertId);
    if (!expert) return;
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "learner", personName: name, task: expert.task, workMapSessionId: expert.id }),
    });
    if (!res.ok) return setError(`Could not create the session (${res.status})`);
    const session: Session = await res.json();
    router.push(`/teach/${session.id}`);
  };

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-5 py-12 text-stone-900">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">04 / Teach</p>
      <h1 className="text-3xl font-extrabold tracking-tight">Learn a workflow</h1>
      <p className="leading-relaxed text-stone-600">Work a case you have not seen. The tutor steps in before a guardrail is broken.</p>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-stone-700">
        Your name
        <input className="rounded-lg border border-stone-300 px-3 py-2 text-base" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-stone-700">
        Work Map to learn from
        <select className="rounded-lg border border-stone-300 px-3 py-2 text-base" value={expertId} onChange={(e) => setExpertId(e.target.value)}>
          {experts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.personName}: {e.task} ({e.id})
            </option>
          ))}
        </select>
      </label>
      {experts.length === 0 && <p className="text-sm text-stone-500">No confirmed Work Map yet. Capture and debrief an expert session first.</p>}
      <div className="flex gap-3">
        <button type="button" disabled={!expertId || !name} onClick={() => void start()} className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-40">
          Start with the tutor
        </button>
        <a href="/hiring?set=learner" target="_blank" rel="noreferrer" className="rounded-lg border border-stone-300 px-4 py-2">
          Open the sandbox
        </a>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </main>
  );
}
