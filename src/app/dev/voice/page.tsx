import * as store from "@/lib/store";
import { DevVoice } from "./DevVoice";

export const dynamic = "force-dynamic";

// Manual test page for the three voice agents. The fixture session supplies
// sample context (gap list, Work Map) and sample screen events.
export default async function DevVoicePage() {
  const [workMap, events] = await Promise.all([store.workMaps.get("fixture_sabine"), store.events.all("fixture_sabine")]);

  const debriefContext = workMap
    ? [
        "Steps seen:",
        ...workMap.steps.map(
          (s) =>
            `- Step ${s.index} (${s.id}): ${s.title}. Decision: ${s.decision}.` +
            (s.reason?.source === "live" ? ` ${workMap.expertName} said: "${s.reason.text}"` : ""),
        ),
        "",
        "Open gaps:",
        ...workMap.gaps.map((g) => `- ${g.id}: ${g.question} (Why it is unclear: ${g.why})`),
      ].join("\n")
    : "";

  return (
    <DevVoice
      debriefContext={debriefContext}
      tutorContext={workMap ? JSON.stringify(workMap) : ""}
      expertName={workMap?.expertName ?? "Sabine"}
      task={workMap?.task ?? "Process supplier invoices"}
      sampleEvents={events.map(({ kind, summary, field, before, after, action, entity }) => ({
        kind,
        summary,
        field,
        before,
        after,
        action,
        entity,
      }))}
    />
  );
}
