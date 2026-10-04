"use client";

import { useMemo, useState } from "react";
import type { Guardrail, WorkMap, WorkStep } from "@/lib/types";

// The Work Map as a flow chart: the steps in order, grouped into phase lanes,
// with a decision diamond wherever a guardrail says to stop and ask.

type Lane = { name: string; description: string; steps: WorkStep[] };

// Lane tints, in order. The last lane is the one the process ends in, so it
// takes the finishing colour.
const LANE_TINT = [
  "bg-indigo-50/70 border-indigo-100",
  "bg-indigo-50/70 border-indigo-100",
  "bg-emerald-50/60 border-emerald-100",
];
const BADGE_TINT = ["bg-indigo-100 text-indigo-800", "bg-indigo-100 text-indigo-800", "bg-emerald-100 text-emerald-800"];

function lanesOf(map: WorkMap): Lane[] {
  const steps = [...map.steps].sort((a, b) => a.index - b.index);
  const named = (map.phases ?? []).filter((p) => steps.some((s) => s.phase === p.name));
  if (named.length === 0) {
    // A map built before phases existed: one lane holding the whole process.
    return [{ name: "The process", description: `Every step of ${map.task}.`, steps }];
  }
  return named.map((p) => ({ name: p.name, description: p.description, steps: steps.filter((s) => s.phase === p.name) }));
}

// The question on the diamond, from the guardrail's own words: everything
// before the first colon, else the machine-checkable condition, else the rule.
function askOf(g: Guardrail) {
  const head = g.rule.split(":")[0].trim();
  if (head && head.length < 70 && head !== g.rule.trim()) return `${head}?`;
  if (g.check?.when) return `${g.check.when}?`;
  return g.rule.length > 70 ? `${g.rule.slice(0, 67).trim()}…` : g.rule;
}

export function WorkMapFlow({ map, onSelectStep }: { map: WorkMap; onSelectStep?: (id: string) => void }) {
  const [zoom, setZoom] = useState(100);
  const lanes = useMemo(() => lanesOf(map), [map]);
  const stops = useMemo(
    () => new Map(map.guardrails.filter((g) => g.type === "stop_and_ask").map((g) => [g.stepId, g])),
    [map.guardrails],
  );

  return (
    <div className="relative">
      <div className="overflow-x-auto pb-2">
        <div
          className="flex min-w-max origin-top-left items-stretch gap-5"
          style={{ zoom: `${zoom}%` }}
        >
          {lanes.map((lane, li) => {
            const last = li === lanes.length - 1;
            return (
              <section
                key={lane.name}
                className={`flex min-w-[320px] flex-col rounded-2xl border px-6 py-6 ${LANE_TINT[Math.min(li, LANE_TINT.length - 1)]}`}
              >
                <header className="flex items-start gap-4">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold ${BADGE_TINT[Math.min(li, BADGE_TINT.length - 1)]}`}
                  >
                    {li + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-2xl font-bold tracking-tight text-stone-900">{lane.name}</h3>
                    {lane.description && <p className="mt-0.5 text-[15px] text-stone-500">{lane.description}</p>}
                  </div>
                </header>

                <div className="mt-7 flex flex-1 items-start gap-3">
                  {lane.steps.map((step, si) => (
                    <div key={step.id} className="flex items-start gap-3">
                      {/* After a decision, this arrow is the "no" way out and
                          leaves the diamond, not the card before it. */}
                      {si > 0 &&
                        (stops.has(lane.steps[si - 1].id) ? <Arrow label="No" align="diamond" /> : <Arrow />)}
                      <StepNode step={step} stop={stops.get(step.id)} onSelect={onSelectStep} />
                    </div>
                  ))}
                  {last &&
                    (stops.has(lane.steps[lane.steps.length - 1]?.id ?? "") ? (
                      <>
                        <Arrow label="No" align="diamond" />
                        <DoneNode />
                      </>
                    ) : (
                      <>
                        <Arrow />
                        <DoneNode />
                      </>
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none sticky bottom-4 flex justify-end pr-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-stone-200 bg-white px-2 py-1.5 shadow-sm">
          <ZoomButton label="Zoom in" onClick={() => setZoom((z) => Math.min(150, z + 10))} d="M8 4.5v7M4.5 8h7" />
          <span className="min-w-[3.5rem] text-center text-sm font-medium tabular-nums text-stone-700">{zoom}%</span>
          <ZoomButton label="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))} d="M4.5 8h7" />
        </div>
      </div>
    </div>
  );
}

export default WorkMapFlow;

// A step, and — when a guardrail says to stop and ask here — the decision that
// hangs off it: "yes" goes down to the person who decides, "no" carries on.
function StepNode({ step, stop, onSelect }: { step: WorkStep; stop?: Guardrail; onSelect?: (id: string) => void }) {
  const card = (
    <button
      type="button"
      onClick={onSelect ? () => onSelect(step.id) : undefined}
      className={`flex w-[170px] flex-col items-start rounded-xl border bg-white px-4 py-4 text-left shadow-[0_1px_2px_rgba(10,37,64,0.05)] transition ${
        onSelect ? "hover:border-indigo-300 hover:shadow-md" : "cursor-default"
      } ${step.isJudgmentCall ? "border-amber-300" : "border-stone-200"}`}
      title={step.decision}
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full ${
          step.isJudgmentCall ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"
        }`}
      >
        {step.isJudgmentCall ? <JudgmentIcon /> : <DocIcon />}
      </span>
      <span className="mt-3 text-[17px] font-semibold leading-tight text-stone-900">{step.title}</span>
      {step.owner && <span className="mt-2 text-sm text-stone-400">{step.owner}</span>}
    </button>
  );

  if (!stop) return card;

  return (
    <div className="flex items-start gap-3">
      {card}
      <Arrow align="diamond" />
      <div className="flex flex-col items-center">
        <Diamond text={askOf(stop)} />
        {/* "yes": down to whoever decides. */}
        <span className="text-sm font-medium text-stone-600">Yes</span>
        <DownArrow />
        <div className="w-[170px] rounded-xl border border-stone-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(10,37,64,0.05)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <PersonIcon />
          </span>
          <p className="mt-3 text-[17px] font-semibold leading-tight text-stone-900">
            Ask {stop.escalateTo ?? "the decision-maker"}
          </p>
          <p className="mt-2 text-sm text-stone-400">Never advance it yourself</p>
        </div>
      </div>
    </div>
  );
}

// A rotated square sticks out of its own layout box by a quarter of its
// diagonal, which is what made the arrows and the "Yes" label collide with the
// corners. The wrapper is the size of the *bounding box* (side x sqrt 2) and
// the rotated face is painted inside it, so nothing overlaps.
const DIAMOND_SIDE = 132;
const DIAMOND_BOX = Math.round(DIAMOND_SIDE * Math.SQRT2); // 187
// Half the box, less half an arrow, so an arrow lines up with the centre.
const DIAMOND_ARROW_OFFSET = Math.round(DIAMOND_BOX / 2 - 6); // 88

function Diamond({ text }: { text: string }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: DIAMOND_BOX, height: DIAMOND_BOX }}
    >
      <span
        className="absolute rotate-45 rounded-lg border border-indigo-300 bg-white shadow-[0_1px_2px_rgba(10,37,64,0.05)]"
        style={{ width: DIAMOND_SIDE, height: DIAMOND_SIDE }}
        aria-hidden
      />
      {/* The biggest upright box inside a diamond is side / sqrt 2. */}
      <span
        className="relative text-center text-[12px] font-semibold leading-tight text-stone-800"
        style={{ maxWidth: Math.floor(DIAMOND_SIDE / Math.SQRT2) - 8 }}
      >
        {text}
      </span>
    </div>
  );
}

function DoneNode() {
  return (
    <div className="w-[150px] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center shadow-[0_1px_2px_rgba(10,37,64,0.05)]">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
          <path d="M3.5 8.4l3.1 3L12.5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="mt-3 text-[17px] font-semibold text-emerald-800">Completed</p>
    </div>
  );
}

// `align` says what the arrow points at: a step card (its icon sits 36px down)
// or a diamond (taller, so the arrow sits at its centre).
function Arrow({ label, align = "card" }: { label?: string; align?: "card" | "diamond" }) {
  return (
    <div
      className="relative flex shrink-0 items-center"
      style={{ marginTop: align === "diamond" ? DIAMOND_ARROW_OFFSET : 36 }}
    >
      {label && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-sm font-medium text-stone-600">{label}</span>
      )}
      <svg viewBox="0 0 32 12" className="h-3 w-8 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M0 6h27m0 0-5-4.5M27 6l-5 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function DownArrow() {
  return (
    <svg viewBox="0 0 12 32" className="h-8 w-3 shrink-0 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M6 0v27m0 0-4.5-5M6 27l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M5 2.5h6.5L15 6v11.5H5z" strokeLinejoin="round" />
      <path d="M11 2.5V6h4M7.5 10h5M7.5 13h5" strokeLinecap="round" />
    </svg>
  );
}

function JudgmentIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M10 2.5 17.5 10 10 17.5 2.5 10z" strokeLinejoin="round" />
      <path d="M10 6.8v4M10 13.4h.01" strokeLinecap="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M4 16.5c0-3 2.7-4.6 6-4.6s6 1.6 6 4.6" strokeLinecap="round" />
    </svg>
  );
}

function ZoomButton({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d={d} strokeLinecap="round" />
      </svg>
    </button>
  );
}
