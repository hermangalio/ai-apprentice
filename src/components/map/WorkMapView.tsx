"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { countsLine, debriefContext, debriefStatus, fmtT, mapCounts } from "@/lib/map/debrief";
import { debriefClientTools } from "@/lib/map/debriefTools";
import type { Gap, Guardrail, Quote, ScreenMoment, WorkMap, WorkStep } from "@/lib/types";
import { DebriefVoiceSlot } from "./DebriefVoiceSlot";

type Meta = { answerTranscriptIds: string[]; building: boolean; readOnly: boolean; debriefTurns: number };

type Props = {
  sessionId: string;
  initialMap: WorkMap | null;
  sessionFound: boolean;
  task: string;
  expertName: string;
  readOnly: boolean;
};

const POLL_MS = 2500;

const TYPE_STYLE: Record<Guardrail["type"], { label: string; cls: string }> = {
  limit: { label: "Limit", cls: "bg-sky-100 text-sky-900 ring-sky-200" },
  exception: { label: "Exception", cls: "bg-violet-100 text-violet-900 ring-violet-200" },
  stop_and_ask: { label: "Stop and ask", cls: "bg-rose-100 text-rose-900 ring-rose-200" },
  never: { label: "Never", cls: "bg-stone-800 text-white ring-stone-800" },
};

export function WorkMapView({ sessionId, initialMap, sessionFound, task, expertName, readOnly: readOnlyInitial }: Props) {
  const [map, setMap] = useState<WorkMap | null>(initialMap);
  const [meta, setMeta] = useState<Meta>({ answerTranscriptIds: [], building: false, readOnly: readOnlyInitial, debriefTurns: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(initialMap?.steps[0]?.id ?? null);
  const [shown, setShown] = useState<ScreenMoment | null>(null); // a guardrail moment picked over the step's own
  const [busy, setBusy] = useState<"build" | "finalize" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/workmap`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${base}?with=meta`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { workMap: WorkMap | null; meta: Meta };
      setMeta(data.meta);
      setMap((prev) => (prev && data.workMap && prev.updatedAt === data.workMap.updatedAt ? prev : data.workMap));
    } catch {
      // Keep showing the last known map.
    }
  }, [base]);

  // Poll so the page follows the debrief while it runs.
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  const steps = useMemo(() => map?.steps ?? [], [map]);
  const selected = steps.find((s) => s.id === selectedId) ?? steps[0] ?? null;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setShown(null);
  }, []);

  // Left and right arrow keys move along the timeline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      const i = steps.findIndex((s) => s.id === (selected?.id ?? ""));
      const next = steps[i + (e.key === "ArrowRight" ? 1 : -1)];
      if (next) select(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps, selected, select]);

  const clientTools = useMemo(() => debriefClientTools(sessionId, (m) => setMap(m)), [sessionId]);
  const context = useMemo(() => (map ? debriefContext(map) : ""), [map]);

  async function run(kind: "build" | "finalize") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(kind === "build" ? base : `${base}/finalize`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? res.statusText);
      setMap(data as WorkMap);
      if (kind === "build") select((data as WorkMap).steps[0]?.id ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const building = busy === "build" || meta.building;
  const readOnly = meta.readOnly;

  if (!map) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl px-6 py-24 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-stone-500">Work Map</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">{task || "No Work Map yet"}</h1>
          <p className="mt-3 text-stone-600">
            {!sessionFound
              ? `There is no session with the id ${sessionId}.`
              : building
                ? "Merging the screen events and the transcript into a draft. This takes up to a minute."
                : `The capture session${expertName ? ` with ${expertName}` : ""} has not been turned into a Work Map yet.`}
          </p>
          {sessionFound && !readOnly && (
            <button
              onClick={() => run("build")}
              disabled={building}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
            >
              {building && <Spinner />}
              {building ? "Building draft" : "Build draft Work Map"}
            </button>
          )}
          {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
        </div>
      </Shell>
    );
  }

  const counts = mapCounts(map);
  const status = debriefStatus(map);
  const answers = new Set(meta.answerTranscriptIds);

  return (
    <Shell>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-stone-500">Work Map, learned from {map.expertName}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">{map.task}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600">
              <Stat n={counts.steps} label={counts.steps === 1 ? "step" : "steps"} />
              <Dot />
              <Stat n={counts.judgmentCalls} label={counts.judgmentCalls === 1 ? "judgment call" : "judgment calls"} tone="amber" />
              <Dot />
              <Stat n={counts.guardrails} label={counts.guardrails === 1 ? "guardrail" : "guardrails"} tone="rose" />
              <span className="sr-only">{countsLine(map)}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`${base}/export`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
              title="The map as instructions an agent can load: steps, rules, when to stop, who to escalate to"
            >
              Export for agents (.md)
            </a>
            <StatusBadge status={map.status} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <main className="min-w-0 space-y-5">
          <Timeline steps={steps} guardrails={map.guardrails} selectedId={selected?.id ?? null} onSelect={select} />
          {selected ? (
            <StepDetail
              key={selected.id}
              sessionId={sessionId}
              step={selected}
              total={steps.length}
              guardrails={map.guardrails.filter((g) => g.stepId === selected.id)}
              gaps={map.gaps.filter((g) => g.stepId === selected.id)}
              expertName={map.expertName}
              answers={answers}
              shown={shown}
              onShow={setShown}
              onPrev={steps[selected.index - 2] ? () => select(steps[selected.index - 2].id) : undefined}
              onNext={steps[selected.index] ? () => select(steps[selected.index].id) : undefined}
            />
          ) : (
            <div className="rounded-xl border border-stone-200 bg-white p-8 text-stone-600">This map has no steps.</div>
          )}
        </main>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-stone-900">Debrief</h2>
              <p className="mt-0.5 text-xs text-stone-500">
                Asks what is still unclear, then explains the process back. Done only when {map.expertName} confirms.
              </p>
            </div>

            <div className="px-4 py-3">
              <div
                className={`rounded-lg px-3 py-2 text-sm ${status.done ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"}`}
              >
                {status.reason}
              </div>
            </div>

            {!readOnly && (
              <div className="px-4 pb-3">
                <DebriefVoiceSlot sessionId={sessionId} context={context} clientTools={clientTools} />
              </div>
            )}

            <div className="border-t border-stone-100 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Gaps ({counts.gaps - counts.openGaps} of {counts.gaps} closed)
              </h3>
              <ul className="mt-2 space-y-3">
                {map.gaps.map((g) => (
                  <GapItem
                    key={g.id}
                    gap={g}
                    step={steps.find((s) => s.id === g.stepId)}
                    expertName={map.expertName}
                    onSelectStep={select}
                  />
                ))}
                {map.gaps.length === 0 && <li className="text-sm text-stone-500">No gaps recorded.</li>}
              </ul>
            </div>

            <div className="border-t border-stone-100 px-4 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Teach-back</h3>
                {map.teachBack?.text && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map.teachBack.confirmed ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}
                  >
                    {map.teachBack.confirmed ? `Confirmed by ${map.expertName}` : "Waiting for confirmation"}
                  </span>
                )}
              </div>
              {map.teachBack?.text ? (
                <p className="mt-2 text-sm leading-relaxed text-stone-700">{map.teachBack.text}</p>
              ) : (
                <p className="mt-2 text-sm text-stone-500">Not given yet. It follows once every gap has been asked.</p>
              )}
              {(map.teachBack?.corrections.length ?? 0) > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-stone-500">
                    {map.teachBack!.corrections.length === 1 ? "Correction" : "Corrections"} from {map.expertName}
                  </p>
                  <ul className="mt-1.5 space-y-2">
                    {map.teachBack!.corrections.map((c, i) => (
                      <li key={i} className="rounded-lg border-l-2 border-amber-400 bg-amber-50/60 px-3 py-2 text-sm text-stone-800">
                        “{c.text}”
                        <span className="mt-0.5 block text-xs text-stone-500">
                          {c.transcriptId ? `${map.expertName}, debrief at ${fmtT(c.t)}` : "As noted by the voice agent, not yet matched to the transcript"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-3">
                <button
                  onClick={() => run("finalize")}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
                  title="Merge the debrief transcript into the map: answers become quotes, new guardrails are added, corrections applied"
                >
                  {busy === "finalize" && <Spinner />}
                  {busy === "finalize" ? "Merging debrief" : "Merge debrief into map"}
                </button>
                <button
                  onClick={() => run("build")}
                  disabled={busy !== null || meta.building}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
                >
                  {building && <Spinner />}
                  {building ? "Rebuilding" : "Rebuild draft"}
                </button>
                {meta.debriefTurns > 0 && <span className="text-xs text-stone-500">{meta.debriefTurns} debrief turns recorded</span>}
                {error && <p className="w-full text-sm text-rose-700">{error}</p>}
              </div>
            )}
          </section>

          <details className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-stone-700">What the debrief agent is given</summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-stone-600">{context}</pre>
          </details>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  // Own colors, so the page reads the same in light and dark system themes.
  return <div className="min-h-screen flex-1 bg-[#f6f5f1] font-sans text-stone-900">{children}</div>;
}

function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

function Dot() {
  return <span className="text-stone-300">/</span>;
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "amber" | "rose" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-stone-900";
  return (
    <span>
      <span className={`font-semibold tabular-nums ${color}`}>{n}</span> {label}
    </span>
  );
}

function StatusBadge({ status }: { status: WorkMap["status"] }) {
  return status === "confirmed" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Confirmed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900 ring-1 ring-amber-300">
      <span className="h-2 w-2 rounded-full bg-amber-500" />
      Draft
    </span>
  );
}

function JudgmentMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300 ${className}`}>
      <span className="inline-block h-1.5 w-1.5 rotate-45 bg-amber-500" />
      Judgment call
    </span>
  );
}

function Timeline({
  steps,
  guardrails,
  selectedId,
  onSelect,
}: {
  steps: WorkStep[];
  guardrails: Guardrail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Steps" className="overflow-x-auto rounded-xl border border-stone-200 bg-white px-2 py-4">
      <ol className="relative grid min-w-[720px]" style={{ gridTemplateColumns: `repeat(${Math.max(steps.length, 1)}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const active = s.id === selectedId;
          const rails = guardrails.filter((g) => g.stepId === s.id).length;
          return (
            <li key={s.id} className="relative">
              {/* connector to the next step */}
              {i < steps.length - 1 && <span className="absolute left-1/2 top-[38px] h-px w-full bg-stone-300" aria-hidden />}
              <button
                onClick={() => onSelect(s.id)}
                aria-current={active ? "step" : undefined}
                className={`group relative flex w-full flex-col items-center gap-1.5 rounded-lg px-1.5 pb-2 pt-1 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-stone-400 ${active ? "bg-stone-100" : "hover:bg-stone-50"}`}
              >
                <span className="text-[11px] tabular-nums text-stone-500">{fmtT(s.moment.t)}</span>
                <span
                  className={`relative z-10 flex h-8 w-8 items-center justify-center text-sm font-semibold transition ${
                    s.isJudgmentCall
                      ? `rotate-45 rounded-md ${active ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-900 ring-1 ring-amber-400"}`
                      : `rounded-full ${active ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-300 group-hover:ring-stone-500"}`
                  }`}
                >
                  <span className={s.isJudgmentCall ? "-rotate-45" : ""}>{s.index}</span>
                </span>
                <span className={`line-clamp-2 min-h-[2.5em] text-xs leading-tight ${active ? "font-semibold text-stone-900" : "text-stone-600"}`}>{s.title}</span>
                <span className="flex h-4 items-center gap-1">
                  {rails > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 text-[10px] font-medium text-rose-800 ring-1 ring-rose-200">
                      <ShieldIcon /> {rails}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-1 flex items-center gap-4 border-t border-stone-100 px-3 pt-3 text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-amber-400" /> judgment call
        </span>
        <span className="inline-flex items-center gap-1.5 text-rose-800">
          <ShieldIcon /> <span className="text-stone-500">guardrails at this step</span>
        </span>
        <span className="ml-auto">Arrow keys move between steps</span>
      </div>
    </nav>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
      <path d="M8 1l5.5 2v4.2c0 3.4-2.3 6.3-5.5 7.8-3.2-1.500-5.5-4.400-5.500-7.800V3L8 1z" />
    </svg>
  );
}

function FrameImage({ sessionId, moment }: { sessionId: string; moment: ScreenMoment }) {
  const [failed, setFailed] = useState(false);
  const src = moment.frameId ? `/api/sessions/${encodeURIComponent(sessionId)}/frames/${encodeURIComponent(moment.frameId)}` : "";
  return (
    <figure className="overflow-hidden rounded-lg border border-stone-200 bg-stone-900">
      <div className="relative aspect-video">
        {src && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Screen at ${moment.label}`} className="absolute inset-0 h-full w-full object-contain" onError={() => setFailed(true)} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-stone-100 text-center text-stone-500">
            <span className="text-2xl font-semibold tabular-nums text-stone-400">{fmtT(moment.t)}</span>
            <span className="px-6 text-sm">{src ? "The frame for this moment could not be loaded." : "No frame was captured for this moment."}</span>
          </div>
        )}
      </div>
      <figcaption className="flex items-center gap-2 bg-stone-900 px-3 py-2 text-xs text-stone-200">
        <span className="rounded bg-white/15 px-1.5 py-0.5 font-medium tabular-nums text-white">{fmtT(moment.t)}</span>
        <span className="truncate">{moment.label.replace(/^\d{1,2}:\d{2},\s*/, "")}</span>
      </figcaption>
    </figure>
  );
}

function quoteOrigin(q: Quote, answers: Set<string>) {
  if (q.source === "debrief") return "debrief";
  return answers.has(q.transcriptId) ? "live question" : "said while working";
}

function QuoteBlock({ quote, expertName, answers }: { quote: Quote; expertName: string; answers: Set<string> }) {
  const origin = quoteOrigin(quote, answers);
  return (
    <blockquote className="border-l-2 border-stone-300 pl-3">
      <p className="text-[15px] leading-snug text-stone-900">“{quote.text}”</p>
      <footer className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
        <span>
          {expertName}, {origin} at {fmtT(quote.t)}
        </span>
        <span
          className={`rounded-full px-1.5 py-px text-[10px] font-medium ${quote.source === "debrief" ? "bg-indigo-100 text-indigo-800" : "bg-teal-100 text-teal-800"}`}
        >
          {quote.source === "debrief" ? "debrief" : "live"}
        </span>
      </footer>
    </blockquote>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-stone-100 py-3 first:border-t-0 first:pt-0 sm:grid-cols-[116px_minmax(0,1fr)] sm:gap-4">
      <dt className="pt-0.5 text-xs font-semibold uppercase tracking-wider text-stone-500">{label}</dt>
      <dd className="min-w-0 text-[15px] text-stone-900">{children}</dd>
    </div>
  );
}

function StepDetail({
  sessionId,
  step,
  total,
  guardrails,
  gaps,
  expertName,
  answers,
  shown,
  onShow,
  onPrev,
  onNext,
}: {
  sessionId: string;
  step: WorkStep;
  total: number;
  guardrails: Guardrail[];
  gaps: Gap[];
  expertName: string;
  answers: Set<string>;
  shown: ScreenMoment | null;
  onShow: (m: ScreenMoment | null) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const moment = shown ?? step.moment;
  const openGaps = gaps.filter((g) => g.status === "open");
  return (
    <article className="rounded-xl border border-stone-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
            Step {step.index} of {total}
          </p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-stone-900">
            {step.title}
            {step.isJudgmentCall && <JudgmentMark />}
          </h2>
        </div>
        <div className="flex gap-1.5">
          <NavButton onClick={onPrev} label="Previous step" d="M10 3L5 8l5 5" />
          <NavButton onClick={onNext} label="Next step" d="M6 3l5 5-5 5" />
        </div>
      </header>

      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <FrameImage key={`${moment.frameId}-${moment.t}`} sessionId={sessionId} moment={moment} />
          {shown && (
            <button onClick={() => onShow(null)} className="mt-2 text-xs text-stone-600 underline underline-offset-2 hover:text-stone-900">
              Showing a guardrail moment. Back to the step moment
            </button>
          )}
        </div>

        <dl>
          <Row label="Screen moment">
            <button
              onClick={() => onShow(null)}
              className="text-left tabular-nums underline decoration-stone-300 underline-offset-4 hover:decoration-stone-700"
              title="Show this moment"
            >
              {step.moment.label}
            </button>
          </Row>
          <Row label="Decision">
            <span className={step.isJudgmentCall ? "font-medium" : ""}>{step.decision}</span>
          </Row>
          <Row label="Reason">
            {step.reason ? (
              <QuoteBlock quote={step.reason} expertName={expertName} answers={answers} />
            ) : (
              <span className="text-sm text-stone-500">
                {openGaps.length > 0 ? `${expertName} gave no reason during the task. It is on the debrief list.` : "A routine step. No reason was given or needed."}
              </span>
            )}
          </Row>
          <Row label="Guardrails">
            {guardrails.length === 0 ? (
              <span className="text-sm text-stone-500">None at this step.</span>
            ) : (
              <ul className="space-y-3">
                {guardrails.map((g) => {
                  const style = TYPE_STYLE[g.type];
                  const isShown = shown?.frameId === g.moment.frameId && shown?.t === g.moment.t;
                  return (
                    <li key={g.id} className="rounded-lg border border-stone-200 bg-stone-50/70 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${style.cls}`}>{style.label}</span>
                        {g.escalateTo && (
                          <span className="text-xs text-stone-600">
                            Escalate to <span className="font-medium text-stone-900">{g.escalateTo}</span>
                          </span>
                        )}
                      </div>
                      <p className="mt-2 font-medium leading-snug text-stone-900">{g.rule}</p>
                      <div className="mt-2">
                        <QuoteBlock quote={g.quote} expertName={expertName} answers={answers} />
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                        <button
                          onClick={() => onShow(isShown ? null : g.moment)}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ring-1 transition ${isShown ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-300 hover:ring-stone-500"}`}
                          title="Show the screen moment this rule is tied to"
                        >
                          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                            <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
                            <path d="M5.5 14h5" strokeLinecap="round" />
                          </svg>
                          {g.moment.label}
                        </button>
                        {g.check && (
                          <code className="rounded bg-white px-1.5 py-1 font-mono text-[11px] text-stone-600 ring-1 ring-stone-200" title="Machine-checkable form used by the tutor">
                            when {g.check.when}
                            {g.check.require ? ` → require ${g.check.require}` : ""}
                            {g.check.forbid ? ` → forbid ${g.check.forbid}` : ""}
                          </code>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Row>
          {openGaps.length > 0 && (
            <Row label="Still unclear">
              <ul className="space-y-1.5 text-sm text-stone-700">
                {openGaps.map((g) => (
                  <li key={g.id} className="flex gap-2">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-amber-500" />
                    {g.question}
                  </li>
                ))}
              </ul>
            </Row>
          )}
        </dl>
      </div>
    </article>
  );
}

function NavButton({ onClick, label, d }: { onClick?: () => void; label: string; d: string }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-30"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d={d} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function GapItem({ gap, step, expertName, onSelectStep }: { gap: Gap; step?: WorkStep; expertName: string; onSelectStep: (id: string) => void }) {
  const icon =
    gap.status === "answered" ? (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M3.5 8.5l3 2.8L12.5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    ) : gap.status === "deferred" ? (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-300 text-xs font-bold text-stone-700">-</span>
    ) : (
      <span className="block h-5 w-5 shrink-0 rounded-full border-2 border-amber-400 bg-white" />
    );
  return (
    <li className="flex gap-2.5">
      <span className="pt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className={`text-sm leading-snug ${gap.status === "open" ? "font-medium text-stone-900" : "text-stone-800"}`}>{gap.question}</p>
        <p className="mt-0.5 text-xs leading-snug text-stone-500">{gap.why}</p>
        {gap.answer && (
          <p className="mt-1.5 rounded-md bg-stone-50 px-2.5 py-1.5 text-sm text-stone-800 ring-1 ring-stone-200">
            “{gap.answer.text}”
            <span className="mt-0.5 block text-xs text-stone-500">
              {expertName}, debrief at {fmtT(gap.answer.t)}
            </span>
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
          <span className="font-mono">{gap.id}</span>
          <span
            className={
              gap.status === "open" ? "font-medium text-amber-700" : gap.status === "answered" ? "text-emerald-700" : "text-stone-600"
            }
          >
            {gap.status === "answered" && !gap.answer ? "answered, quote pending merge" : gap.status}
          </span>
          {step && (
            <button onClick={() => onSelectStep(step.id)} className="underline underline-offset-2 hover:text-stone-900">
              step {step.index}: {step.title}
            </button>
          )}
        </p>
      </div>
    </li>
  );
}
