"use client";

import type { Scorecard } from "@/lib/types";
import type { ScoreItem } from "@/lib/teach/progress";

// End-of-session view: what was mastered, what to practice next, what did not come up.

const GROUPS: { status: ScoreItem["status"]; title: string; empty: string; tone: string; dot: string }[] = [
  {
    status: "mastered",
    title: "Mastered",
    empty: "Nothing handled without help yet.",
    tone: "border-emerald-200 bg-emerald-50",
    dot: "bg-emerald-500",
  },
  {
    status: "practice",
    title: "Practice next",
    empty: "Nothing to repeat.",
    tone: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
  },
  {
    status: "not_seen",
    title: "Not seen yet",
    empty: "Every guardrail came up.",
    tone: "border-stone-200 bg-white",
    dot: "bg-stone-300",
  },
];

export function ScorecardView({
  scorecard,
  items,
  learnerName,
  onBack,
}: {
  scorecard: Scorecard;
  items: ScoreItem[];
  learnerName: string;
  onBack?: () => void;
}) {
  const caught = scorecard.interventions.filter((i) => i.outcome === "corrected").length;
  const broken = scorecard.interventions.filter((i) => i.outcome === "overridden").length;
  const answered = scorecard.predictions.filter((p) => p.correct !== undefined);
  const right = answered.filter((p) => p.correct).length;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-stone-900">Scorecard for {learnerName}</h2>
        <p className="mt-1 text-xs text-stone-600">
          Based on what happened on screen: which rules came up, where the tutor stepped in, and the prediction questions.
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-stone-200 bg-white px-2 py-2">
          <dt className="text-[11px] text-stone-500">Caught before saving</dt>
          <dd className="text-lg font-semibold tabular-nums text-stone-900">{caught}</dd>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-2 py-2">
          <dt className="text-[11px] text-stone-500">Saved against a rule</dt>
          <dd className="text-lg font-semibold tabular-nums text-stone-900">{broken}</dd>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-2 py-2">
          <dt className="text-[11px] text-stone-500">Predictions right</dt>
          <dd className="text-lg font-semibold tabular-nums text-stone-900">
            {right}/{answered.length}
          </dd>
        </div>
      </dl>

      {GROUPS.map((group) => {
        const list = items.filter((i) => i.status === group.status);
        return (
          <div key={group.status}>
            <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-600">
              <span className={`h-2 w-2 rounded-full ${group.dot}`} />
              {group.title} ({list.length})
            </h3>
            {list.length === 0 ? (
              <p className="text-xs text-stone-500">{group.empty}</p>
            ) : (
              <ul className="space-y-2">
                {list.map((item) => (
                  <li key={item.id} className={`rounded-xl border px-3 py-2 ${group.tone}`}>
                    <p className="text-sm font-medium leading-snug text-stone-900">{item.label}</p>
                    <p className="mt-0.5 text-xs text-stone-600">{item.note}</p>
                    {item.quote && group.status === "practice" && (
                      <p className="mt-1.5 border-l-2 border-amber-400 pl-2 text-xs italic text-stone-700">{item.quote}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100"
        >
          Back to the session
        </button>
      )}
    </section>
  );
}
