import type { WorkMap } from "../types";
import { debriefStatus } from "./debrief";

// Client-side handlers for the tools the debrief voice agent calls. Each one
// PATCHes the Work Map, calls onChange, and returns a short string that the
// agent hears as the tool result, so it knows what is left to do.

export type DebriefClientTools = {
  mark_gap: (params: { gap_id: string; status?: "open" | "answered" | "deferred" }) => Promise<string>;
  teach_back: (params: { text: string }) => Promise<string>;
  teach_back_result: (params: { confirmed: boolean | string; correction?: string }) => Promise<string>;
};

export type DebriefToolOptions = {
  // After the expert confirms the teach-back, merge the debrief transcript
  // into the map. Default true.
  autoFinalize?: boolean;
  // Wait before finalizing so the last transcript items reach the store.
  finalizeDelayMs?: number;
};

export function debriefClientTools(
  sessionId: string,
  onChange?: (map: WorkMap) => void,
  options: DebriefToolOptions = {},
): DebriefClientTools {
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/workmap`;

  async function patch(body: unknown): Promise<WorkMap | string> {
    try {
      const res = await fetch(base, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) return `Error: ${data?.error ?? res.statusText}`;
      onChange?.(data as WorkMap);
      return data as WorkMap;
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  const openIds = (map: WorkMap) => map.gaps.filter((g) => g.status === "open").map((g) => g.id);

  return {
    async mark_gap({ gap_id, status }) {
      const map = await patch({ gap: { id: gap_id, status: status ?? "answered" } });
      if (typeof map === "string") return map;
      const open = openIds(map);
      return open.length
        ? `Recorded. Still open: ${open.join(", ")}. Ask the next one.`
        : "Recorded. No gaps are open. Now give the teach-back and call teach_back with what you said.";
    },

    async teach_back({ text }) {
      const map = await patch({ teachBack: { text, confirmed: false } });
      if (typeof map === "string") return map;
      const open = openIds(map);
      return open.length
        ? `Teach-back recorded, but these gaps are still open: ${open.join(", ")}. Ask them, then teach back again.`
        : "Teach-back recorded. Ask the expert whether it is right, then call teach_back_result.";
    },

    async teach_back_result({ confirmed, correction }) {
      const ok = confirmed === true || confirmed === "true";
      const map = await patch({ teachBack: { confirmed: ok, ...(correction ? { correction } : {}) } });
      if (typeof map === "string") return map;
      const status = debriefStatus(map);
      if (!status.done) {
        return ok
          ? `Recorded, but the debrief is not complete. ${status.reason}`
          : "Correction recorded. Restate the corrected part, ask again whether it is right, and call teach_back_result again.";
      }
      if (options.autoFinalize !== false) {
        // Not awaited: the merge takes a model call and the agent should not wait for it.
        void (async () => {
          await new Promise((r) => setTimeout(r, options.finalizeDelayMs ?? 2500));
          try {
            const res = await fetch(`${base}/finalize`, { method: "POST" });
            if (res.ok) onChange?.((await res.json()) as WorkMap);
          } catch {
            // The page has a Finalize button as a fallback.
          }
        })();
      }
      return "Confirmed. The debrief is complete. Thank the expert and end the conversation.";
    },
  };
}
