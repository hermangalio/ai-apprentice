import type { WorkMap } from "../types";

// Pure helpers shared by the server (build, routes) and the client (map page,
// debrief tools). No store or fs imports here.

export function fmtT(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function mapCounts(map: WorkMap) {
  return {
    steps: map.steps.length,
    judgmentCalls: map.steps.filter((s) => s.isJudgmentCall).length,
    guardrails: map.guardrails.length,
    gaps: map.gaps.length,
    openGaps: map.gaps.filter((g) => g.status === "open").length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function countsLine(map: WorkMap) {
  const c = mapCounts(map);
  return `${plural(c.steps, "step")}, ${plural(c.judgmentCalls, "judgment call")}, ${plural(c.guardrails, "guardrail")}`;
}

export type DebriefStatus = { done: boolean; reason: string };

// The completion rule, in one place: every gap has been asked (answered or
// explicitly deferred) and the expert has confirmed the teach-back.
export function debriefStatus(map: WorkMap): DebriefStatus {
  const open = map.gaps.filter((g) => g.status === "open");
  const deferred = map.gaps.filter((g) => g.status === "deferred").length;
  const name = map.expertName || "the expert";
  const total = map.gaps.length;

  if (open.length > 0) {
    return {
      done: false,
      reason: `Not done: ${open.length} of ${plural(total, "gap")} still open (${open.map((g) => g.id).join(", ")}).`,
    };
  }
  if (!map.teachBack || !map.teachBack.text) {
    return { done: false, reason: `Not done: all ${plural(total, "gap")} asked, teach-back not given yet.` };
  }
  if (!map.teachBack.confirmed) {
    const n = map.teachBack.corrections.length;
    return {
      done: false,
      reason:
        n > 0
          ? `Not done: ${name} corrected the teach-back (${plural(n, "correction")}) and has not confirmed it yet.`
          : `Not done: teach-back given, waiting for ${name} to confirm it.`,
    };
  }
  const n = map.teachBack.corrections.length;
  const gapsPart =
    deferred > 0
      ? `${total - deferred} of ${plural(total, "gap")} were answered, ${deferred} deferred by ${name}`
      : total === 0
        ? "there were no open gaps"
        : `all ${plural(total, "gap")} were answered`;
  return {
    done: true,
    reason: `Done because ${gapsPart}, and ${name} confirmed the teach-back${n > 0 ? ` after ${plural(n, "correction")}` : ""}.`,
  };
}

export function isDebriefDone(map: WorkMap) {
  return debriefStatus(map).done;
}

// The text handed to the debrief voice agent as its context.
export function debriefContext(map: WorkMap) {
  const name = map.expertName || "the expert";
  const lines: string[] = [];
  lines.push(`Debrief with ${name} about the task: ${map.task}.`);
  lines.push("");
  lines.push("What you understood from watching (draft process):");
  for (const s of map.steps) {
    const rails = map.guardrails.filter((g) => g.stepId === s.id);
    lines.push(
      `${s.index}. ${s.title}. Seen: ${s.decision}.` +
        (s.reason ? ` ${name} said: "${s.reason.text}"` : " No reason given yet.") +
        (s.isJudgmentCall ? " (judgment call)" : ""),
    );
    for (const g of rails) {
      lines.push(`   Guardrail (${g.type.replace(/_/g, " ")}): ${g.rule}${g.escalateTo ? ` Escalate to: ${g.escalateTo}.` : ""}`);
    }
  }
  lines.push("");
  const open = map.gaps.filter((g) => g.status === "open");
  const closed = map.gaps.filter((g) => g.status !== "open");
  lines.push(`Open gaps to ask (${open.length}):`);
  if (open.length === 0) lines.push("(none)");
  for (const g of open) {
    const step = map.steps.find((s) => s.id === g.stepId);
    lines.push(`- ${g.id}: ${g.question}`);
    lines.push(`  Why it is unclear: ${g.why}${step ? ` (step ${step.index}: ${step.title})` : ""}`);
  }
  if (closed.length > 0) {
    lines.push("");
    lines.push("Gaps already closed (do not ask again):");
    for (const g of closed) lines.push(`- ${g.id} (${g.status}): ${g.question}`);
  }
  lines.push("");
  lines.push("Completion rule:");
  lines.push(
    "1. Ask each open gap, one at a time, in your own calm words. After the expert answers, call mark_gap with the gap_id and status \"answered\". If they do not know or want to skip it, call mark_gap with status \"deferred\". Do not ask about things already covered above.",
  );
  lines.push(
    "2. When no gap is open, explain the whole process back in under a minute, including what you learned in this debrief. Call teach_back with the text you said, then ask if that is right.",
  );
  lines.push(
    "3. Call teach_back_result with confirmed true or false. If the expert corrects something, pass the correction in their words, restate only the corrected part, and ask again.",
  );
  lines.push(
    "4. The debrief is done only when every gap is answered or deferred and the expert has confirmed the teach-back. Then thank them and end the conversation.",
  );
  return lines.join("\n");
}
