import * as store from "@/lib/store";

// The work map library: every expert session that has a map, with just enough
// of it to draw a row. One request, so the page does not fetch each map.

export const dynamic = "force-dynamic";

export type WorkMapSummary = {
  sessionId: string;
  task: string;
  expertName: string;
  status: "draft" | "confirmed";
  updatedAt: string;
  steps: number;
  openGaps: number;
};

// Sessions written by the test scripts are not part of the library.
const isTest = (task: string, id: string) => task.startsWith("[test]") || id.startsWith("maptest_");

export async function GET() {
  const sessions = await store.sessions.list();
  const rows: WorkMapSummary[] = [];

  for (const s of sessions) {
    if (s.role !== "expert" || isTest(s.task, s.id)) continue;
    const map = await store.workMaps.get(s.id);
    if (!map) continue;
    rows.push({
      sessionId: s.id,
      task: map.task || s.task,
      expertName: map.expertName || s.personName,
      status: map.status,
      updatedAt: map.updatedAt,
      steps: map.steps.length,
      openGaps: map.gaps.filter((g) => g.status === "open").length,
    });
  }

  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return Response.json(rows, { headers: { "cache-control": "no-store" } });
}
