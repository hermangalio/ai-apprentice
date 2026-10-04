// Client-side state of the sandbox hiring desk, persisted to localStorage.
// Used through useSyncExternalStore; the snapshot is null until init() ran in the browser.

import { seedCandidates, type EditableFields, type ErpSet, type Candidate, type CandidateStatus } from "./seed";

export type ErpState = { set: ErpSet; sets: Record<ErpSet, Candidate[]> };

// Bump the version when the seed changes shape, so stored data from an older seed is dropped.
const STORAGE_KEY = "hiring.state.v2";

let state: ErpState | null = null;
const listeners = new Set<() => void>();

function persist() {
  try {
    if (state) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private window). The sandbox still works in memory.
  }
}

function setState(next: ErpState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

function load(): ErpState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ErpState;
      if (parsed && parsed.sets && Array.isArray(parsed.sets.expert) && Array.isArray(parsed.sets.learner)) {
        return { set: parsed.set === "learner" ? "learner" : "expert", sets: parsed.sets };
      }
    }
  } catch {
    // Fall through to fresh seed data.
  }
  return { set: "expert", sets: seedCandidates() };
}

function replaceCandidate(id: string, change: (inv: Candidate) => Candidate): Candidate | null {
  if (!state) return null;
  let updated: Candidate | null = null;
  const sets = { ...state.sets };
  (Object.keys(sets) as ErpSet[]).forEach((key) => {
    sets[key] = sets[key].map((c) => {
      if (c.id !== id) return c;
      updated = change(c);
      return updated;
    });
  });
  if (updated) setState({ ...state, sets });
  return updated;
}

export const erpStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): ErpState | null {
    return state;
  },
  getServerSnapshot(): ErpState | null {
    return null;
  },
  // Loads persisted state. `set` (from the query string) wins over the remembered set.
  init(set?: ErpSet): ErpState {
    const loaded = state ?? load();
    const next = set && set !== loaded.set ? { ...loaded, set } : loaded;
    setState(next);
    return next;
  },
  setSet(set: ErpSet) {
    if (state && state.set !== set) setState({ ...state, set });
  },
  find(id: string): { candidate: Candidate; set: ErpSet } | null {
    if (!state) return null;
    for (const key of Object.keys(state.sets) as ErpSet[]) {
      const candidate = state.sets[key].find((c) => c.id === id);
      if (candidate) return { candidate, set: key };
    }
    return null;
  },
  // Changes the form values only. Nothing is saved until commit().
  updateDraft(id: string, patch: Partial<EditableFields>): Candidate | null {
    return replaceCandidate(id, (c) => ({ ...c, draft: { ...c.draft, ...patch } }));
  },
  // Saves the form values and sets the new status. No business rule is checked.
  commit(id: string, status: CandidateStatus): Candidate | null {
    return replaceCandidate(id, (c) => ({ ...c, status, saved: { ...c.draft } }));
  },
  reset() {
    setState({ set: state?.set ?? "expert", sets: seedCandidates() });
  },
};

export function hasUnsavedChanges(candidate: Candidate): boolean {
  return (
    candidate.draft.track !== candidate.saved.track ||
    candidate.draft.interviewer !== candidate.saved.interviewer ||
    candidate.draft.note !== candidate.saved.note
  );
}
