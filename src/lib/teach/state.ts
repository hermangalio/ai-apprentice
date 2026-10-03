import * as store from "../store";
import type { Intervention, Prediction, Scorecard } from "../types";
import type { Severity } from "./check";

// Server-only. Teach state for a learner session lives in scorecard.json: the
// Scorecard fields plus a few extra ones the tutor needs between requests.

export type TeachIntervention = Intervention & {
  invoiceId?: string;
  severity: Severity;
  question: string;
  quote: string;
  explanation: string;
  instruction: string;
  field?: string; // ERP field to highlight
  decidedBy: "rule" | "model";
};

export type TeachState = Omit<Scorecard, "interventions"> & {
  interventions: TeachIntervention[];
  // "<invoiceId>:<stepId>" keys of prediction cues already issued.
  cued: string[];
};

const blank = (sessionId: string): TeachState => ({
  sessionId,
  mastered: [],
  practiceNext: [],
  interventions: [],
  predictions: [],
  cued: [],
});

export async function getTeachState(sessionId: string): Promise<TeachState> {
  const raw = (await store.scorecards.get(sessionId)) as Partial<TeachState> | null;
  return { ...blank(sessionId), ...(raw ?? {}), sessionId };
}

// Read-modify-write under a per-session lock, kept across hot reloads.
const locks = ((globalThis as Record<string, unknown>).__teachLocks ??= new Map()) as Map<string, Promise<unknown>>;

export function mutateTeachState<T>(sessionId: string, fn: (state: TeachState) => T | Promise<T>): Promise<T> {
  const run = (locks.get(sessionId) ?? Promise.resolve()).then(async () => {
    const state = await getTeachState(sessionId);
    const out = await fn(state);
    await store.scorecards.set(sessionId, state);
    return out;
  });
  locks.set(
    sessionId,
    run.catch(() => {}),
  );
  return run;
}

export type { Prediction };
