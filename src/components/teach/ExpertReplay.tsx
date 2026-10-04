"use client";

import { useEffect, useMemo, useState } from "react";
import type { Frame, ScreenEvent, ScreenMoment } from "@/lib/types";

// Replays the expert's screen around one moment: the frame before, the moment
// itself and the frame after, as a short slideshow with captions taken from
// the expert's events.

const clock = (t: number) => {
  const s = Math.round(t / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

type Slide = { frame: Frame; caption: string; role: "before" | "moment" | "after" };

const SLIDE_MS = 2800;

export function ExpertReplay({
  expertSessionId,
  expertName,
  frames,
  events,
  moment,
}: {
  expertSessionId: string;
  expertName: string;
  frames: Frame[];
  events: ScreenEvent[];
  moment: ScreenMoment;
}) {
  const slides = useMemo<Slide[]>(() => {
    const sorted = [...frames].sort((a, b) => a.t - b.t);
    const i = sorted.findIndex((f) => f.id === moment.frameId);
    const caption = (f: Frame, fallback: string) =>
      events
        .filter((e) => e.frameId === f.id)
        .map((e) => e.summary)
        .join(". ") || fallback;
    if (i < 0) {
      // The moment's frame is not in the list: show it alone and let the image decide.
      return [{ frame: { id: moment.frameId, t: moment.t, file: "" }, caption: moment.label, role: "moment" }];
    }
    // A neighbouring frame belongs to the replay only when it shows the same
    // case as the moment (the next invoice being opened is not part of it).
    const entityOf = (f: Frame) => events.find((e) => e.frameId === f.id && e.entity)?.entity?.id;
    const here = entityOf(sorted[i]);
    const sameCase = (f: Frame) => !here || !entityOf(f) || entityOf(f) === here;
    const out: Slide[] = [];
    if (i > 0 && sameCase(sorted[i - 1])) {
      out.push({ frame: sorted[i - 1], caption: caption(sorted[i - 1], "Just before"), role: "before" });
    }
    out.push({ frame: sorted[i], caption: caption(sorted[i], moment.label), role: "moment" });
    if (i < sorted.length - 1 && sameCase(sorted[i + 1])) {
      out.push({ frame: sorted[i + 1], caption: caption(sorted[i + 1], "Just after"), role: "after" });
    }
    return out;
  }, [frames, events, moment]);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [missing, setMissing] = useState<Record<string, boolean>>({});

  // Play once from the first slide and stop on the last one.
  useEffect(() => {
    if (!playing) return;
    if (index >= slides.length - 1) return;
    const timer = setTimeout(() => setIndex((i) => Math.min(i + 1, slides.length - 1)), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [playing, index, slides.length]);

  const slide = slides[Math.min(index, slides.length - 1)];
  if (!slide) return null;
  const src = `/api/sessions/${expertSessionId}/frames/${slide.frame.id}`;
  const roleLabel = slide.role === "moment" ? "The moment" : slide.role === "before" ? "Before" : "After";

  return (
    <figure className="overflow-hidden rounded-xl border border-stone-300 bg-white">
      <div className="flex items-center justify-between bg-stone-800 px-3 py-1.5 text-xs text-stone-100">
        <span className="font-medium">{expertName}&apos;s screen</span>
        <span className="font-mono tabular-nums">
          {clock(slide.frame.t)} · {roleLabel}
        </span>
      </div>
      <div className="relative aspect-video bg-stone-200">
        {missing[slide.frame.id] ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-stone-500">
            Screenshot not available. {moment.label}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={slide.frame.id}
            src={src}
            alt={`${expertName}'s screen at ${clock(slide.frame.t)}: ${slide.caption}`}
            className="h-full w-full object-contain"
            onError={() => setMissing((m) => ({ ...m, [slide.frame.id]: true }))}
          />
        )}
        {slide.role === "moment" && (
          <span className="absolute left-2 top-2 rounded-lg bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-900">
            {moment.label}
          </span>
        )}
      </div>
      <figcaption className="space-y-2 px-3 py-2">
        <p className="text-xs leading-snug text-stone-700">{slide.caption}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.frame.id}
                type="button"
                aria-label={`Show slide ${i + 1} of ${slides.length}`}
                onClick={() => {
                  setPlaying(false);
                  setIndex(i);
                }}
                className={`h-1.5 w-6 rounded-full ${i === index ? "bg-stone-800" : "bg-stone-300 hover:bg-stone-400"}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setPlaying(true);
            }}
            className="text-xs font-medium text-stone-600 underline-offset-2 hover:underline"
          >
            Replay
          </button>
        </div>
      </figcaption>
    </figure>
  );
}
