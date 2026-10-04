"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageWaves } from "@/components/PageWaves";
import type { WorkMapSummary } from "@/app/api/workmaps/route";

// The library of work maps the team has captured so far.

type Filter = "all" | "ready" | "drafts";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "drafts", label: "Drafts" },
];

export default function WorkMapsPage() {
  const [rows, setRows] = useState<WorkMapSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workmaps", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<WorkMapSummary[]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === "ready" && r.status !== "confirmed") return false;
      if (filter === "drafts" && r.status !== "draft") return false;
      if (!q) return true;
      return r.task.toLowerCase().includes(q) || r.expertName.toLowerCase().includes(q);
    });
  }, [rows, query, filter]);

  return (
    <main className="relative flex-1 px-5 pb-24 pt-14">
      <PageWaves />
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-[44px] font-extrabold leading-tight tracking-tight text-stone-900">Work maps</h1>
            <p className="mt-1 text-[19px] text-stone-500">Capture knowledge once. Help others use it.</p>
          </div>
          <Link
            href="/capture"
            className="inline-flex items-center gap-2.5 rounded-lg bg-indigo-600 px-6 py-3.5 text-[17px] font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            New capture
          </Link>
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <label className="relative min-w-[260px] flex-1">
            <span className="sr-only">Search work maps</span>
            <svg
              viewBox="0 0 16 16"
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search work maps"
              className="w-full rounded-xl border border-stone-200 bg-white py-3.5 pl-11 pr-4 text-[17px] text-stone-900 placeholder:text-stone-400"
            />
          </label>

          <div
            role="tablist"
            aria-label="Filter work maps"
            className="flex rounded-xl border border-stone-200 bg-white p-1.5"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-lg px-7 py-2 text-[17px] font-medium transition ${
                  filter === f.id ? "bg-indigo-50 text-indigo-700" : "text-stone-500 hover:text-stone-800"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {error ? (
            <Empty>Could not load the work maps ({error}).</Empty>
          ) : rows === null ? (
            <Empty>Loading…</Empty>
          ) : shown.length === 0 ? (
            <Empty>
              {rows.length === 0 ? (
                <>
                  No work maps yet.{" "}
                  <Link href="/capture" className="font-medium text-indigo-600 underline underline-offset-2">
                    Capture one
                  </Link>{" "}
                  to get started.
                </>
              ) : (
                "Nothing matches that."
              )}
            </Empty>
          ) : (
            <ul>
              {shown.map((row) => (
                <Row key={row.sessionId} row={row} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-14 text-center text-[17px] text-stone-500">{children}</p>;
}

function Row({ row }: { row: WorkMapSummary }) {
  const ready = row.status === "confirmed";
  return (
    <li className="flex flex-wrap items-center gap-4 border-b border-stone-100 px-7 py-5 last:border-b-0 hover:bg-stone-50/60">
      <div className="min-w-[200px] flex-1">
        <Link href={`/map/${row.sessionId}`} className="text-[21px] font-bold tracking-tight text-stone-900 hover:text-indigo-700">
          {row.task}
        </Link>
        <p className="mt-0.5 text-[15px] text-stone-500">
          {row.expertName} · Updated {relativeDay(row.updatedAt)}
        </p>
      </div>

      <span
        className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[15px] font-medium ${
          ready ? "bg-indigo-50 text-indigo-800" : "bg-stone-100 text-stone-600"
        }`}
        title={ready ? `${row.steps} steps` : `${row.openGaps} open question${row.openGaps === 1 ? "" : "s"}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${ready ? "bg-indigo-600" : "bg-stone-400"}`} />
        {ready ? "Ready" : "Draft"}
      </span>

      <Link
        href={`/map/${row.sessionId}`}
        className="rounded-lg border border-indigo-200 px-7 py-2.5 text-[17px] font-medium text-indigo-700 hover:bg-indigo-50"
      >
        {ready ? "Open" : "Continue"}
      </Link>

      <RowMenu row={row} />
    </li>
  );
}

// Export and copy-link, the two things that work on a map from here.
function RowMenu({ row }: { row: WorkMapSummary }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/map/${row.sessionId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${row.task}`}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
          <a
            role="menuitem"
            href={`/api/sessions/${encodeURIComponent(row.sessionId)}/workmap/export`}
            target="_blank"
            rel="noreferrer"
            className="block px-4 py-2.5 text-[15px] text-stone-800 hover:bg-stone-50"
          >
            Export for agents (.md)
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => void copy()}
            className="block w-full px-4 py-2.5 text-left text-[15px] text-stone-800 hover:bg-stone-50"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

// "today", "yesterday", "3 days ago".
function relativeDay(iso: string) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "recently";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
