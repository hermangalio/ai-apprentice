import type { CaseFacts, Guardrail, ScreenEvent, WorkMap, WorkStep } from "../types";
import { actionWord, describeCase, type Severity } from "./check";

// Text handed to the tutor voice agent. Pure functions, no I/O.

const firstSentence = (s: string) => {
  const m = /^.*?[.!?](?=\s|$)/.exec(s.trim());
  return m ? m[0] : s.trim();
};

export function interventionQuestion(workMap: WorkMap, severity: Severity): string {
  return severity === "broken"
    ? `${workMap.expertName} would not have done that. Can you see why?`
    : `${workMap.expertName} would stop here. Why do you think?`;
}

// What the learner is doing, in one sentence, for the tutor.
function situation(event: ScreenEvent, facts: CaseFacts, severity: Severity): string {
  const c = describeCase(facts);
  if (event.action) {
    const verb = actionWord(event.action);
    const cc = facts.cost_center ? ` with cost center ${facts.cost_center}` : "";
    return severity === "broken"
      ? `The learner has already chosen to ${verb} ${c}${cc}.`
      : `The learner is about to ${verb} ${c}${cc}.`;
  }
  if (event.kind === "field_change" && event.field) {
    return `The learner set ${event.field.replace(/_/g, " ")} to ${event.after || "empty"} on ${c}. It is not saved yet.`;
  }
  return `The learner is working on ${c}.`;
}

export function interventionInstruction(
  workMap: WorkMap,
  g: Guardrail,
  event: ScreenEvent,
  facts: CaseFacts,
  severity: Severity,
): string {
  const question = interventionQuestion(workMap, severity);
  const who = workMap.expertName;
  const head = severity === "broken" ? `BROKEN guardrail ${g.id}.` : `INTERVENE guardrail ${g.id}.`;
  const parts = [
    head,
    situation(event, facts, severity),
    severity === "broken"
      ? `It is already saved, so do not scold. Ask first: "${question}"`
      : `Speak now, before it is saved. Ask first: "${question}"`,
    `Then give ${who}'s reason in ${who}'s own words: "${g.quote.text}"`,
    g.escalateTo ? `Say who to go to: ${g.escalateTo}.` : "",
    `Then call show_expert_moment with guardrail_id ${g.id}.`,
    severity === "broken"
      ? `Tell the learner this one goes on the practice list, then call log_intervention_outcome with guardrail_id ${g.id} and outcome "overridden".`
      : `When the learner has fixed it, call log_intervention_outcome with guardrail_id ${g.id} and outcome "corrected". If they go ahead anyway, use outcome "overridden".`,
  ];
  return parts.filter(Boolean).join(" ");
}

// The on-screen and spoken message stored on the Intervention record.
export function interventionMessage(workMap: WorkMap, g: Guardrail, severity: Severity): string {
  return `${interventionQuestion(workMap, severity)} ${workMap.expertName}: "${g.quote.text}"`;
}

export function predictionPrompt(workMap: WorkMap): string {
  return `Before you touch anything: what would ${workMap.expertName} do with this invoice, and why?`;
}

// `g` is the guardrail at stake on this case; its rule is the answer.
export function predictionInstruction(workMap: WorkMap, step: WorkStep, g: Guardrail, facts: CaseFacts): string {
  const who = workMap.expertName;
  const defaults = facts.cost_center ? ` The default cost center is ${facts.cost_center}.` : "";
  return [
    `PREDICT step ${step.id} ("${step.title}").`,
    `The learner just opened ${describeCase(facts)}.${defaults}`,
    `Guardrail ${g.id} applies to this case: ${g.rule}`,
    `Do not reveal it yet. Ask: "${predictionPrompt(workMap)}"`,
    `Wait for the answer. Then say what ${who} would do and give the reason in ${who}'s own words: "${g.quote.text}"`,
    `Then call log_prediction with step_id ${step.id}, the prompt, the learner's answer, and whether it was correct.`,
  ].join(" ");
}

// Session-start context for the tutor voice agent.
export function tutorContext(workMap: WorkMap): string {
  const who = workMap.expertName;
  const byId = new Map(workMap.guardrails.map((g) => [g.id, g]));
  const lines: string[] = [];

  lines.push(
    `You are a voice tutor. You teach a new hire the task "${workMap.task}" the way ${who} does it. ` +
      `Everything you know about the task comes from ${who}'s Work Map below. Do not invent rules that are not in it.`,
  );
  lines.push("");
  lines.push("HOW TO COACH");
  lines.push(
    `- The learner works real cases in the ERP in another tab. You are told what they do through messages that start with INTERVENE, BROKEN or PREDICT. Follow those messages exactly and at once.`,
  );
  lines.push(`- Explain each step the way ${who} did. Quote ${who}'s words where a quote is given, and say that they are ${who}'s words.`);
  lines.push(`- Before a judgment step, ask the learner to predict what ${who} would do. Reveal the decision and the reason only after they answer. Then call log_prediction.`);
  lines.push(`- Step in before a guardrail is broken. Question first ("${who} would stop here. Why do you think?"), then ${who}'s reason, then call show_expert_moment so the learner sees ${who}'s screen at that moment.`);
  lines.push(`- After an intervention, call log_intervention_outcome with "corrected" if the learner fixed it, or "overridden" if they went ahead.`);
  lines.push(`- Keep every turn short: one or two sentences. Stay quiet while the learner is reading or typing and nothing is at stake.`);
  lines.push(`- If the learner asks why, answer from the quotes below. If the Work Map does not cover it, say so and name who to ask.`);
  lines.push("");
  lines.push("STEPS, IN ORDER");
  for (const s of [...workMap.steps].sort((a, b) => a.index - b.index)) {
    lines.push(`${s.index}. [${s.id}] ${s.title}${s.isJudgmentCall ? " (judgment call: ask for a prediction first)" : ""}`);
    lines.push(`   What ${who} did: ${s.decision}`);
    if (s.reason) lines.push(`   ${who}'s reason: "${s.reason.text}"`);
    for (const gid of s.guardrailIds) {
      const g = byId.get(gid);
      if (g) lines.push(`   Guardrail ${g.id}: ${g.rule}`);
    }
    lines.push(`   Screen moment: ${s.moment.label}`);
  }
  lines.push("");
  lines.push("GUARDRAILS");
  for (const g of workMap.guardrails) {
    lines.push(`[${g.id}] (${g.type.replace(/_/g, " ")}, step ${g.stepId}) ${g.rule}`);
    lines.push(`   ${who}'s words: "${g.quote.text}"`);
    if (g.escalateTo) lines.push(`   Escalate to: ${g.escalateTo}`);
    lines.push(`   Screen moment: ${g.moment.label}`);
  }
  if (workMap.teachBack?.corrections.length) {
    lines.push("");
    lines.push(`CORRECTIONS ${who.toUpperCase()} MADE`);
    for (const c of workMap.teachBack.corrections) lines.push(`- "${c.text}"`);
  }
  lines.push("");
  lines.push("TOOLS");
  lines.push("- show_expert_moment({ guardrail_id?, step_id? }): replays the expert's screen for that guardrail or step.");
  lines.push("- log_prediction({ step_id, prompt, learner_answer, correct }): records a prediction question and the answer.");
  lines.push('- log_intervention_outcome({ guardrail_id, outcome }): outcome is "corrected" or "overridden".');
  return lines.join("\n");
}

export const shortQuote = firstSentence;
