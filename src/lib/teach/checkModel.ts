import { warmSession } from "../llm";
import type { Guardrail, ScreenEvent, WorkMap } from "../types";
import { mergedFacts, type CheckResult, type Severity } from "./check";

// Model fallback for what the deterministic path cannot decide: guardrails
// without a `check`, and vision events whose facts are incomplete. Server-only.

type ModelVerdict = {
  guardrail_id: string;
  status: "not_applicable" | "ok" | "at_risk" | "violated";
  explanation?: string;
};

const SYSTEM = `You check whether a new hire is about to break one of an expert's guardrails in a business application.
You get the guardrails, the facts of the case on screen, the event that just happened, and the recent events.
For each guardrail listed under "decide", answer with one of:
- "not_applicable": the rule is not about this case, or the facts needed to tell are missing.
- "ok": the rule applies and what the learner did respects it.
- "at_risk": the rule applies and is not satisfied yet, but the learner has not done anything wrong yet.
- "violated": the learner just set a value or attempted an action that breaks the rule.
Be conservative: only say "violated" when the facts on hand show it.
Answer with a JSON array: [{"guardrail_id": "...", "status": "...", "explanation": "one short sentence"}]`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("model check timed out")), ms)),
  ]);
}

// Decides `undecided` guardrails and returns the additions to a CheckResult.
export async function checkWithModel(
  workMap: WorkMap,
  event: ScreenEvent,
  history: ScreenEvent[],
  undecided: Guardrail[],
  timeoutMs = 20000,
): Promise<Pick<CheckResult, "violations" | "atRisk" | "satisfied">> {
  const out: Pick<CheckResult, "violations" | "atRisk" | "satisfied"> = { violations: [], atRisk: [], satisfied: [] };
  if (undecided.length === 0) return out;

  const session = warmSession(`teach-check:${workMap.sessionId}`, { system: SYSTEM, model: "haiku", maxCalls: 20 });
  const prompt = JSON.stringify(
    {
      decide: undecided.map((g) => ({ id: g.id, type: g.type, rule: g.rule, check: g.check, expert_words: g.quote.text })),
      facts: mergedFacts(event, history),
      event: {
        kind: event.kind,
        summary: event.summary,
        field: event.field,
        before: event.before,
        after: event.after,
        action: event.action,
        committed: event.committed === true,
      },
      recent_events: history.slice(-6).map((h) => h.summary),
    },
    null,
    1,
  );

  const verdicts = await withTimeout(session.askJSON<ModelVerdict[]>(prompt), timeoutMs);
  if (!Array.isArray(verdicts)) return out;
  const severity: Severity = event.committed === true ? "broken" : "about_to_break";
  for (const v of verdicts) {
    const g = undecided.find((x) => x.id === v.guardrail_id);
    if (!g) continue;
    if (v.status === "violated") {
      out.violations.push({ guardrail: g, severity, explanation: `${v.explanation ?? ""} Rule: ${g.rule}`.trim() });
      out.atRisk.push(g);
    } else if (v.status === "at_risk") out.atRisk.push(g);
    else if (v.status === "ok") out.satisfied.push(g);
  }
  return out;
}
