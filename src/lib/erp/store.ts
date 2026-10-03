// Client-side state of the sandbox ERP, persisted to localStorage.
// Used through useSyncExternalStore; the snapshot is null until init() ran in the browser.

import { seedInvoices, type EditableFields, type ErpSet, type Invoice, type InvoiceStatus } from "./seed";

export type ErpState = { set: ErpSet; sets: Record<ErpSet, Invoice[]> };

const STORAGE_KEY = "erp.state.v1";

let state: ErpState | null = null;
const listeners = new Set<() => void>();

function persist() {
  try {
    if (state) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private window). The ERP still works in memory.
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
  return { set: "expert", sets: seedInvoices() };
}

function replaceInvoice(id: string, change: (inv: Invoice) => Invoice): Invoice | null {
  if (!state) return null;
  let updated: Invoice | null = null;
  const sets = { ...state.sets };
  (Object.keys(sets) as ErpSet[]).forEach((key) => {
    sets[key] = sets[key].map((inv) => {
      if (inv.id !== id) return inv;
      updated = change(inv);
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
  find(id: string): { invoice: Invoice; set: ErpSet } | null {
    if (!state) return null;
    for (const key of Object.keys(state.sets) as ErpSet[]) {
      const invoice = state.sets[key].find((i) => i.id === id);
      if (invoice) return { invoice, set: key };
    }
    return null;
  },
  // Changes the form values only. Nothing is saved until commit().
  updateDraft(id: string, patch: Partial<EditableFields>): Invoice | null {
    return replaceInvoice(id, (inv) => ({ ...inv, draft: { ...inv.draft, ...patch } }));
  },
  // Saves the form values and sets the new status. No business rule is checked.
  commit(id: string, status: InvoiceStatus): Invoice | null {
    return replaceInvoice(id, (inv) => ({ ...inv, status, saved: { ...inv.draft } }));
  },
  reset() {
    setState({ set: state?.set ?? "expert", sets: seedInvoices() });
  },
};

export function hasUnsavedChanges(invoice: Invoice): boolean {
  return (
    invoice.draft.costCenter !== invoice.saved.costCenter ||
    invoice.draft.assetNumber !== invoice.saved.assetNumber ||
    invoice.draft.note !== invoice.saved.note
  );
}
