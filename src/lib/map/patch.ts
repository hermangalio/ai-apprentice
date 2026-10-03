import path from "path";
import { sessionDir, transcript as transcriptStore, workMaps } from "../store";
import type { Gap, Quote, WorkMap } from "../types";
import { isDebriefDone } from "./debrief";
import { resolveQuote } from "./validate";

// Server-only helpers for the workmap routes.

// Fixture sessions are the reference data for the demo and are never written.
export async function isReadOnly(sessionId: string) {
  const dir = await sessionDir(sessionId);
  return dir.split(path.sep).includes("fixtures");
}

export type WorkMapPatch = {
  // One or several gap status changes.
  gap?: { id: string; status: Gap["status"] };
  gaps?: { id: string; status: Gap["status"] }[];
  teachBack?: {
    text?: string;
    confirmed?: boolean;
    // The expert's correction as the voice agent heard it. It is matched
    // against the debrief transcript; finalize replaces it with the exact words.
    correction?: string;
  };
};

const STATUSES: Gap["status"][] = ["open", "answered", "deferred"];

// Patches are serialized per session so two tool calls cannot overwrite each other.
const queues = ((globalThis as Record<string, unknown>).__workMapPatchQueues ??= new Map()) as Map<string, Promise<unknown>>;

export function patchWorkMap(sessionId: string, patch: WorkMapPatch): Promise<WorkMap> {
  const run = (queues.get(sessionId) ?? Promise.resolve()).then(() => applyPatch(sessionId, patch));
  queues.set(sessionId, run.catch(() => {}));
  return run;
}

async function applyPatch(sessionId: string, patch: WorkMapPatch): Promise<WorkMap> {
  const map = await workMaps.get(sessionId);
  if (!map) throw new Error("No Work Map for this session yet");

  for (const change of [...(patch.gap ? [patch.gap] : []), ...(patch.gaps ?? [])]) {
    const gap = map.gaps.find((g) => g.id === change?.id);
    if (!gap) throw new Error(`Unknown gap id: ${change?.id}. Known ids: ${map.gaps.map((g) => g.id).join(", ")}`);
    if (!STATUSES.includes(change.status)) throw new Error(`Gap status must be one of ${STATUSES.join(", ")}`);
    gap.status = change.status;
    if (change.status === "open") delete gap.answer;
  }

  if (patch.teachBack) {
    const tb = map.teachBack ?? { text: "", confirmed: false, corrections: [] };
    if (typeof patch.teachBack.text === "string" && patch.teachBack.text.trim()) {
      tb.text = patch.teachBack.text.trim();
      // A new teach-back has to be confirmed again.
      if (patch.teachBack.confirmed === undefined) tb.confirmed = false;
    }
    if (typeof patch.teachBack.confirmed === "boolean") tb.confirmed = patch.teachBack.confirmed;
    const correction = patch.teachBack.correction?.trim();
    if (correction) {
      const transcript = (await transcriptStore.all(sessionId)).filter((x) => x.phase === "debrief").sort((a, b) => a.t - b.t);
      const exact = resolveQuote({ text: correction }, transcript);
      const last = transcript[transcript.length - 1];
      // transcriptId "" marks a correction not yet matched to the transcript.
      const quote: Quote = exact ?? { text: correction, transcriptId: "", t: last?.t ?? 0, source: "debrief" };
      if (!tb.corrections.some((c) => c.text === quote.text)) tb.corrections.push(quote);
    }
    map.teachBack = tb;
  }

  // Only finalize promotes a map to "confirmed". A patch can take it back to draft.
  if (map.status === "confirmed" && !isDebriefDone(map)) map.status = "draft";
  map.updatedAt = new Date().toISOString();
  await workMaps.set(sessionId, map);
  return map;
}
