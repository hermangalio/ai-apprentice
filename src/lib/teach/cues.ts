// Client-side bookkeeping for the tutor panel: which interventions are still
// open on the invoice on screen, the one intervention waiting for the voice
// to connect, and which screen lines were already sent to the voice agent.
// This file has no runtime imports so plain Node scripts can load it.

export type SpeechCue = { kind: "intervention" | "prediction"; guardrailId?: string; stepId?: string };

// ---------------------------------------------------------------------------
// Open interventions
// ---------------------------------------------------------------------------

// The parts of a check response the tracker reads.
export type TrackedResult = {
  invoiceId?: string;
  violations: { guardrailId: string; repeat: boolean }[];
  atRisk: { id: string }[];
  undecided?: string[];
  skipped?: string;
};

export type TrackedEvent = {
  // Date.now() of the learner's step in the ERP tab.
  wall: number;
  kind?: string;
  committed?: boolean;
};

export type TrackUpdate = {
  // The result belongs to an event older than one already handled. Ignore it.
  stale: boolean;
  // Guardrails whose open intervention is settled by this result.
  settled: string[];
  // The invoice was committed or left: nothing on it is pending any more.
  all: boolean;
};

// A stored copy of an event carries almost the same time as the live one.
const SAME_EVENT_MS = 250;

export function createCueTracker() {
  let invoiceId: string | undefined;
  let lastWall = 0;
  const open = new Set<string>();

  const closeAll = () => {
    const ids = [...open];
    open.clear();
    return ids;
  };

  return {
    openIds: () => [...open],
    update(res: TrackedResult, ev: TrackedEvent): TrackUpdate {
      if (res.skipped) return { stale: false, settled: [], all: false };
      if (ev.wall < lastWall - SAME_EVENT_MS) return { stale: true, settled: [], all: false };
      lastWall = Math.max(lastWall, ev.wall);

      // Back to the queue, or another invoice: the earlier case is over.
      if (!res.invoiceId) {
        if (ev.kind !== "open") return { stale: false, settled: [], all: false };
        invoiceId = undefined;
        return { stale: false, settled: closeAll(), all: true };
      }
      let settled: string[] = [];
      let all = false;
      if (res.invoiceId !== invoiceId) {
        all = invoiceId !== undefined || open.size > 0;
        settled = closeAll();
        invoiceId = res.invoiceId;
      }

      // A committed action ends the case. What it broke is already saved, so
      // nothing stays open.
      if (ev.kind === "action" && ev.committed === true) {
        return { stale: false, settled: [...settled, ...closeAll()], all: true };
      }

      const pending = new Set([
        ...res.violations.map((v) => v.guardrailId),
        ...res.atRisk.map((g) => g.id),
        ...(res.undecided ?? []),
      ]);
      for (const id of [...open]) {
        if (pending.has(id)) continue;
        open.delete(id);
        settled.push(id);
      }
      for (const v of res.violations) open.add(v.guardrailId);
      return { stale: false, settled, all };
    },
  };
}

// ---------------------------------------------------------------------------
// The intervention waiting for the voice
// ---------------------------------------------------------------------------

export const PENDING_SPEECH_MAX_AGE_MS = 20000;

export type PendingSpeech = { instruction: string; cue: SpeechCue; at: number };

// Holds the latest instruction that could not be spoken because the voice was
// not connected. It is dropped when the learner has settled it or it is old.
export function createPendingSpeech(maxAgeMs = PENDING_SPEECH_MAX_AGE_MS, now: () => number = Date.now) {
  let item: PendingSpeech | null = null;
  return {
    set(instruction: string, cue: SpeechCue) {
      item = { instruction, cue, at: now() };
    },
    settle(guardrailIds: string[], all: boolean) {
      if (!item) return;
      if (all || (item.cue.guardrailId !== undefined && guardrailIds.includes(item.cue.guardrailId))) item = null;
    },
    get waiting() {
      return item !== null;
    },
    // Returns the instruction if it is still worth speaking, and forgets it.
    take(): PendingSpeech | null {
      const p = item;
      item = null;
      return p && now() - p.at <= maxAgeMs ? p : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Seen-once filter
// ---------------------------------------------------------------------------

// The same learner step reaches the panel twice: live over the
// BroadcastChannel and again as the stored copy. first() is true only once
// per key within the window.
export function createOnce(windowMs = 5000) {
  let seen: { key: string; wall: number }[] = [];
  return {
    first(key: string, wall: number): boolean {
      if (seen.some((s) => s.key === key && Math.abs(s.wall - wall) < windowMs)) return false;
      seen = [...seen.slice(-99), { key, wall }];
      return true;
    },
  };
}

// The ERP's keep-alive event while the learner types in a text field.
export const isTypingPing = (e: { kind?: string; summary?: string; action?: string }) =>
  e.kind === "other" && !e.action && (e.summary ?? "") === "typing";
