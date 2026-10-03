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
      for (const s of all.filter((x) => x.role === "expert")) {
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
    <main className="mx-auto flex max-w-xl flex-col gap-5 p-8 text-stone-900">
      <h1 className="text-2xl font-semibold">Learn a workflow</h1>
      <label className="flex flex-col gap-1 text-sm">
        Your name
        <input className="rounded border border-stone-300 px-3 py-2 text-base" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Work Map to learn from
        <select className="rounded border border-stone-300 px-3 py-2 text-base" value={expertId} onChange={(e) => setExpertId(e.target.value)}>
          {experts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.personName}: {e.task} ({e.id})
            </option>
          ))}
        </select>
      </label>
      {experts.length === 0 && <p className="text-sm text-stone-500">No confirmed Work Map yet. Capture and debrief an expert session first.</p>}
      <div className="flex gap-3">
        <button type="button" disabled={!expertId || !name} onClick={() => void start()} className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-40">
          Start with the tutor
        </button>
        <a href="/erp?set=learner" target="_blank" rel="noreferrer" className="rounded border border-stone-300 px-4 py-2">
          Open the sandbox ERP
        </a>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </main>
  );
}
