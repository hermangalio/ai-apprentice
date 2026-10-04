"use client";

import { useEffect, useRef } from "react";
import type { ScreenEvent } from "@/lib/types";

const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// Compact live list of screen events, newest at the bottom.
export function EventFeed({
  events,
  onSelect,
  className = "",
}: {
  events: ScreenEvent[];
  onSelect?: (event: ScreenEvent) => void;
  className?: string;
}) {
  const endRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  if (events.length === 0) {
    return <p className={`text-sm text-zinc-500 ${className}`}>No events yet.</p>;
  }
  return (
    <ol className={`flex flex-col gap-1 overflow-y-auto text-sm ${className}`}>
      {events.map((e) => (
        <li
          key={e.id}
          onClick={onSelect ? () => onSelect(e) : undefined}
          className={`flex items-baseline gap-2 rounded-lg px-2 py-1 ${onSelect ? "cursor-pointer hover:bg-zinc-100" : ""}`}
        >
          <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-500">{clock(e.t)}</span>
          <span className="min-w-0 flex-1 text-zinc-900">
            {e.summary}
            {e.kind === "field_change" && e.committed === false && (
              <span className="ml-1 text-xs text-amber-700">(unsaved)</span>
            )}
          </span>
          <span
            className={`shrink-0 rounded-lg px-1.5 text-[10px] uppercase tracking-wide ${
              e.source === "dom" ? "bg-sky-100 text-sky-800" : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {e.source}
          </span>
        </li>
      ))}
      <li ref={endRef} />
    </ol>
  );
}

export default EventFeed;
