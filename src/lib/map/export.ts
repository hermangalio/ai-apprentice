import type { Guardrail, WorkMap } from "../types";
import { fmtT } from "./debrief";

// Renders a Work Map as instructions an agent can load: the steps in order,
// and for each guardrail the rule, when to stop, and who to escalate to.

const TYPE_LABEL: Record<Guardrail["type"], string> = {
  limit: "Limit",
  exception: "Exception",
  stop_and_ask: "Stop and ask",
  never: "Never",
};

function stopLine(g: Guardrail) {
  if (g.check?.forbid) return `Stop when \`${g.check.when}\` and you are about to do \`${g.check.forbid}\`.`;
  if (g.check?.require) return `Stop when \`${g.check.when}\` and \`${g.check.require}\` does not hold.`;
  return "Stop when this rule applies and you cannot satisfy it. There is no machine-checkable form, so apply the rule as written.";
}

export function workMapToMarkdown(map: WorkMap) {
  const name = map.expertName;
  const out: string[] = [];
  out.push(`# ${map.task}`);
  out.push("");
  out.push(
    `Instructions learned from ${name}. Status: ${map.status === "confirmed" ? `confirmed by ${name} in a teach-back` : "DRAFT, not confirmed by the expert. Do not act on it without supervision"}. Last updated ${map.updatedAt}.`,
  );
  out.push("");
  out.push("## How to use this");
  out.push("");
  out.push("- Follow the steps in order for each case.");
  out.push("- Before every action that saves, posts or sends, check the guardrails of that step and the global list below.");
  out.push("- If a guardrail says stop, do not proceed. Escalate to the named person and wait.");
  out.push("- If the case does not fit any step or rule here, stop and escalate. Do not guess.");
  out.push("");
  out.push("## Steps");
  out.push("");
  for (const s of map.steps) {
    out.push(`### ${s.index}. ${s.title}${s.isJudgmentCall ? " (judgment call)" : ""}`);
    out.push("");
    out.push(`- What ${name} did: ${s.decision}`);
    if (s.reason) out.push(`- Why, in ${name}'s words: "${s.reason.text}" (${s.reason.source === "debrief" ? "debrief" : "during the task"}, ${fmtT(s.reason.t)})`);
    out.push(`- Screen moment: ${s.moment.label}`);
    const rails = map.guardrails.filter((g) => g.stepId === s.id);
    if (rails.length) out.push(`- Guardrails: ${rails.map((g) => g.id).join(", ")} (see below)`);
    out.push("");
  }
  out.push("## Guardrails");
  out.push("");
  if (map.guardrails.length === 0) out.push("None recorded.");
  for (const g of map.guardrails) {
    const step = map.steps.find((s) => s.id === g.stepId);
    out.push(`### ${g.id}: ${TYPE_LABEL[g.type]}${step ? `, at step ${step.index}` : ""}`);
    out.push("");
    out.push(`- Rule: ${g.rule}`);
    out.push(`- When to stop: ${stopLine(g)}`);
    out.push(`- Escalate to: ${g.escalateTo ?? "not named by the expert. Ask your supervisor"}`);
    out.push(`- Source: "${g.quote.text}" (${name}, ${g.quote.source === "debrief" ? "debrief" : "during the task"}, ${fmtT(g.quote.t)})`);
    if (g.check) out.push(`- Check: \`${JSON.stringify(g.check)}\``);
    out.push("");
  }
  const corrections = map.teachBack?.corrections ?? [];
  if (corrections.length) {
    out.push("## Corrections from the expert");
    out.push("");
    out.push("These correct common misreadings of the process. They take precedence over anything above that seems to conflict.");
    out.push("");
    for (const c of corrections) out.push(`- "${c.text}"`);
    out.push("");
  }
  const unresolved = map.gaps.filter((g) => g.status !== "answered");
  if (unresolved.length) {
    out.push("## Not known yet");
    out.push("");
    out.push("The expert has not answered these. If a case depends on one of them, stop and escalate.");
    out.push("");
    for (const g of unresolved) out.push(`- ${g.question} (${g.status})`);
    out.push("");
  }
  return out.join("\n");
}
