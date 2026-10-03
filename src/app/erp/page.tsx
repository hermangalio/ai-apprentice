"use client";

// Sandbox accounts payable system. Queue and invoice detail in one client page.
// It enforces no business rule: any invoice can be posted, held or sent on.
// Every user step is posted on BroadcastChannel(ERP_CHANNEL), see src/lib/erp/events.ts.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ERP_CONTROL,
  actionSummary,
  emitErpEvent,
  fieldChangeSummary,
  formatDate,
  formatEUR,
  historyOpenedSummary,
  invoiceOpenedSummary,
  poOpenedSummary,
  queueOpenedSummary,
  type ErpAction,
  type ErpControlMessage,
} from "@/lib/erp/events";
import { COST_CENTERS, type EditableFields, type ErpSet, type Invoice, type InvoiceStatus } from "@/lib/erp/seed";
import { erpStore, hasUnsavedChanges } from "@/lib/erp/store";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: "Open",
  posted: "Posted",
  on_hold: "On hold",
  awaiting_approval: "Awaiting second approval",
};

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  open: "bg-white text-slate-900 border-slate-500",
  posted: "bg-green-700 text-white border-green-800",
  on_hold: "bg-amber-500 text-black border-amber-700",
  awaiting_approval: "bg-blue-700 text-white border-blue-900",
};

const ACTION_STATUS: Record<ErpAction, InvoiceStatus> = {
  save: "posted",
  hold: "on_hold",
  send_for_approval: "awaiting_approval",
  reopen: "open",
};

// Draft key -> event field name.
const FIELD_NAME: Record<keyof EditableFields, string> = {
  costCenter: "cost_center",
  assetNumber: "asset_number",
  note: "note",
};

const HIGHLIGHT_MS = 4000;
const TEXT_SETTLE_MS = 800; // a text field counts as changed after this pause in typing
const TYPING_PING_MS = 1000;

function costCenterLabel(code: string): string {
  const cc = COST_CENTERS.find((c) => c.code === code);
  return cc ? `${cc.code} ${cc.name}` : code;
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`inline-block rounded border-2 px-3 py-1 text-base font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function ErpPage() {
  const state = useSyncExternalStore(erpStore.subscribe, erpStore.getSnapshot, erpStore.getServerSnapshot);
  const [openId, setOpenId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const started = useRef(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeUrl = useCallback((set: ErpSet, invoiceId: string | null) => {
    const params = new URLSearchParams({ set });
    if (invoiceId) params.set("invoice", invoiceId);
    window.history.replaceState(null, "", `/erp?${params.toString()}`);
  }, []);

  const showQueue = useCallback(() => {
    const s = erpStore.getSnapshot();
    if (!s) return;
    setOpenId(null);
    writeUrl(s.set, null);
    emitErpEvent({ kind: "open", summary: queueOpenedSummary(s.sets[s.set]) });
  }, [writeUrl]);

  const openInvoice = useCallback(
    (id: string) => {
      const found = erpStore.find(id);
      if (!found) return;
      erpStore.setSet(found.set);
      setOpenId(id);
      writeUrl(found.set, id);
      emitErpEvent({ kind: "open", summary: invoiceOpenedSummary(found.invoice) }, found.invoice);
    },
    [writeUrl],
  );

  const switchSet = useCallback(
    (set: ErpSet) => {
      erpStore.setSet(set);
      showQueue();
    },
    [showQueue],
  );

  // First load: pick the set from the query string, else the remembered one.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("set");
    const s = erpStore.init(q === "expert" || q === "learner" ? q : undefined);
    const invoiceId = params.get("invoice");
    if (invoiceId && erpStore.find(invoiceId)) {
      openInvoice(invoiceId);
    } else {
      writeUrl(s.set, null);
      emitErpEvent({ kind: "open", summary: queueOpenedSummary(s.sets[s.set]) });
    }
  }, [openInvoice, writeUrl]);

  // Control channel: coaching highlight and remote navigation.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const control = new BroadcastChannel(ERP_CONTROL);
    control.onmessage = (e: MessageEvent<ErpControlMessage>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "highlight" && typeof msg.field === "string") {
        const field = msg.field.trim().toLowerCase().replace(/[\s-]+/g, "_");
        setHighlight(field);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
        document.querySelector(`[data-erp-field="${CSS.escape(field)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (msg.type === "open_invoice" && typeof msg.id === "string") {
        openInvoice(String(msg.id));
      }
    };
    return () => control.close();
  }, [openInvoice]);

  if (!state) {
    return <main className="p-8 text-xl">Loading AP Workbench ...</main>;
  }

  const invoices = state.sets[state.set];
  const current = openId ? invoices.find((i) => i.id === openId) ?? null : null;

  return (
    <main className="mx-auto w-full max-w-7xl p-6">
      <style>{`
        @keyframes erp-pulse {
          0%, 100% { box-shadow: 0 0 0 4px #f97316, 0 0 0 10px rgba(249, 115, 22, 0.35); }
          50% { box-shadow: 0 0 0 6px #f97316, 0 0 0 20px rgba(249, 115, 22, 0); }
        }
        .erp-highlight { animation: erp-pulse 0.8s ease-in-out infinite; border-radius: 8px; background-color: #ffedd5; }
      `}</style>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-900 px-6 py-4 text-white">
        <div>
          <div className="text-2xl font-bold">AP Workbench</div>
          <div className="text-base text-slate-300">Accounts payable, sandbox system</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-slate-300">Invoice set:</span>
          {(["expert", "learner"] as ErpSet[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => switchSet(s)}
              className={`rounded border-2 px-3 py-1 text-base font-semibold ${
                state.set === s ? "border-white bg-white text-slate-900" : "border-slate-500 text-slate-200 hover:border-white"
              }`}
            >
              {s === "expert" ? "Expert" : "Learner"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (!window.confirm("Reset all invoices to their original state?")) return;
              erpStore.reset();
              showQueue();
            }}
            className="ml-4 rounded border-2 border-red-300 px-3 py-1 text-base font-semibold text-red-200 hover:bg-red-900"
          >
            Reset data
          </button>
        </div>
      </header>

      {current ? (
        <InvoiceDetail key={current.id} invoice={current} highlight={highlight} onBack={showQueue} />
      ) : (
        <Queue invoices={invoices} onOpen={openInvoice} />
      )}
    </main>
  );
}

function Queue({ invoices, onOpen }: { invoices: Invoice[]; onOpen: (id: string) => void }) {
  const open = invoices.filter((i) => i.status === "open").length;
  return (
    <section className="rounded-lg border-2 border-slate-300 bg-white p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Invoice queue</h1>
        <div className="text-xl font-semibold">
          {open} open of {invoices.length} invoices
        </div>
      </div>
      <table className="w-full border-collapse text-left text-xl">
        <thead>
          <tr className="border-b-2 border-slate-900 text-base uppercase tracking-wide text-slate-600">
            <th className="py-3 pr-4">Invoice</th>
            <th className="py-3 pr-4">Supplier</th>
            <th className="py-3 pr-4">Description</th>
            <th className="py-3 pr-4 text-right">Amount</th>
            <th className="py-3 pr-4">Invoice date</th>
            <th className="py-3 pr-4">Status</th>
            <th className="py-3" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="cursor-pointer border-b border-slate-300 hover:bg-slate-100" onClick={() => onOpen(inv.id)}>
              <td className="py-4 pr-4 font-mono text-2xl font-bold">{inv.id}</td>
              <td className="py-4 pr-4 font-semibold">
                {inv.supplier.name}
                <SupplierBadges invoice={inv} small />
              </td>
              <td className="py-4 pr-4">{inv.description}</td>
              <td className="py-4 pr-4 text-right font-mono font-semibold">{formatEUR(inv.amount)}</td>
              <td className="py-4 pr-4 font-mono">{formatDate(inv.date)}</td>
              <td className="py-4 pr-4">
                <StatusBadge status={inv.status} />
                {hasUnsavedChanges(inv) && <div className="mt-1 text-base font-bold text-amber-700">Unsaved changes</div>}
              </td>
              <td className="py-4 text-right">
                <button type="button" className="rounded bg-slate-900 px-4 py-2 text-lg font-semibold text-white">
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SupplierBadges({ invoice, small }: { invoice: Invoice; small?: boolean }) {
  const size = small ? "text-sm px-2 py-0.5" : "text-base px-3 py-1";
  return (
    <>
      {invoice.supplier.isGroupCompany && (
        <span className={`ml-3 inline-block rounded bg-purple-700 font-bold uppercase text-white ${size}`}>Group company</span>
      )}
      {!invoice.supplier.known && (
        <span className={`ml-3 inline-block rounded bg-red-700 font-bold uppercase text-white ${size}`}>New supplier</span>
      )}
    </>
  );
}

function Fact({ label, field, highlight, children }: { label: string; field?: string; highlight: string | null; children: React.ReactNode }) {
  return (
    <div data-erp-field={field} className={`p-2 ${field && highlight === field ? "erp-highlight" : ""}`}>
      <div className="text-sm font-bold uppercase tracking-wide text-slate-600">{label}</div>
      <div className="text-xl font-semibold">{children}</div>
    </div>
  );
}

function InvoiceDetail({ invoice, highlight, onBack }: { invoice: Invoice; highlight: string | null; onBack: () => void }) {
  const [showPo, setShowPo] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Last value reported in a field_change event, per text field.
  const reported = useRef<EditableFields>({ ...invoice.draft });
  const timers = useRef<Partial<Record<keyof EditableFields, ReturnType<typeof setTimeout>>>>({});
  const lastPing = useRef(0);
  const id = invoice.id;

  const locked = invoice.status !== "open";
  const unsaved = hasUnsavedChanges(invoice);
  const hl = (field: string) => (highlight === field ? "erp-highlight" : "");

  // Emits the pending field_change of a text field, if its value differs from the last reported one.
  const flush = useCallback(
    (key: keyof EditableFields) => {
      const t = timers.current[key];
      if (t) clearTimeout(t);
      delete timers.current[key];
      const inv = erpStore.find(id)?.invoice;
      if (!inv) return;
      const before = reported.current[key];
      const after = inv.draft[key];
      if (before === after) return;
      reported.current[key] = after;
      const field = FIELD_NAME[key];
      emitErpEvent(
        { kind: "field_change", summary: fieldChangeSummary(field, before, after), field, before, after, committed: false },
        inv,
      );
    },
    [id],
  );

  const flushAll = useCallback(() => {
    flush("assetNumber");
    flush("note");
  }, [flush]);

  // Report a half-typed value when the user leaves the invoice.
  useEffect(() => flushAll, [flushAll]);

  const changeCostCenter = (after: string) => {
    const before = invoice.draft.costCenter;
    if (before === after) return;
    const inv = erpStore.updateDraft(id, { costCenter: after });
    if (!inv) return;
    reported.current.costCenter = after;
    emitErpEvent(
      { kind: "field_change", summary: fieldChangeSummary("cost_center", before, after), field: "cost_center", before, after, committed: false },
      inv,
    );
  };

  const changeText = (key: "assetNumber" | "note", value: string) => {
    const inv = erpStore.updateDraft(id, { [key]: value });
    if (!inv) return;
    const now = Date.now();
    if (now - lastPing.current >= TYPING_PING_MS) {
      lastPing.current = now;
      emitErpEvent({ kind: "other", summary: "typing", field: FIELD_NAME[key], committed: false }, inv);
    }
    const t = timers.current[key];
    if (t) clearTimeout(t);
    timers.current[key] = setTimeout(() => flush(key), TEXT_SETTLE_MS);
  };

  const act = (action: ErpAction) => {
    flushAll();
    const inv = erpStore.commit(id, ACTION_STATUS[action]);
    if (!inv) return;
    emitErpEvent({ kind: "action", summary: actionSummary(action, inv), action, committed: true }, inv);
  };

  // Posting is a two-step action, as in most ERPs: Post opens a review
  // dialog and nothing is saved until it is confirmed. The request is
  // reported as an uncommitted action so an observer sees the intent first.
  const requestPost = () => {
    flushAll();
    const inv = erpStore.find(id)?.invoice;
    if (!inv) return;
    setConfirming(true);
    emitErpEvent({ kind: "action", summary: `Posting of invoice ${inv.id} requested, confirmation open`, action: "save", committed: false }, inv);
  };

  const cancelPost = () => {
    setConfirming(false);
    emitErpEvent({ kind: "other", summary: `Posting of invoice ${id} cancelled`, committed: false }, invoice);
  };

  const confirmPost = () => {
    setConfirming(false);
    act("save");
  };

  const togglePo = () => {
    const next = !showPo;
    setShowPo(next);
    if (next) emitErpEvent({ kind: "navigate", summary: poOpenedSummary(invoice) }, invoice);
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) emitErpEvent({ kind: "navigate", summary: historyOpenedSummary(invoice) }, invoice);
  };

  const changes: string[] = [];
  if (invoice.draft.costCenter !== invoice.saved.costCenter)
    changes.push(`Cost center ${invoice.saved.costCenter} to ${invoice.draft.costCenter}`);
  if (invoice.draft.assetNumber !== invoice.saved.assetNumber)
    changes.push(`Asset number "${invoice.saved.assetNumber}" to "${invoice.draft.assetNumber}"`);
  if (invoice.draft.note !== invoice.saved.note) changes.push("Posting note");

  const po = invoice.purchaseOrder;
  const inputClass =
    "w-full rounded border-2 border-slate-900 bg-white px-3 py-2 text-2xl font-semibold text-slate-900 disabled:border-slate-400 disabled:bg-slate-200 disabled:text-slate-700";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onBack} className="rounded border-2 border-slate-900 bg-white px-4 py-2 text-lg font-semibold">
            Back to queue
          </button>
          <h1 className="text-3xl font-bold">
            Invoice <span className="font-mono">{invoice.id}</span>
          </h1>
          <span data-erp-field="status" className={hl("status")}>
            <StatusBadge status={invoice.status} />
          </span>
        </div>
        <div
          data-testid="save-indicator"
          className={`rounded border-2 px-4 py-2 text-xl font-bold ${
            unsaved ? "border-amber-700 bg-amber-300 text-black" : "border-green-800 bg-green-100 text-green-900"
          }`}
        >
          {unsaved ? `UNSAVED CHANGES: ${changes.join(", ")}` : locked ? "All changes saved" : "No unsaved changes"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-lg border-2 border-slate-300 bg-white p-5">
          <h2 className="mb-3 text-2xl font-bold">Invoice</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Fact label="Supplier" field="supplier" highlight={highlight}>
                {invoice.supplier.name}
                <SupplierBadges invoice={invoice} />
              </Fact>
            </div>
            <Fact label="Supplier country" highlight={highlight}>
              {invoice.supplier.countryName} ({invoice.supplier.country})
            </Fact>
            <Fact label="Supplier master" highlight={highlight}>
              {invoice.supplier.known ? "Existing supplier" : "Not in supplier master"}
            </Fact>
            <Fact label="Amount" field="amount" highlight={highlight}>
              <span className="font-mono text-2xl">{formatEUR(invoice.amount)}</span>
            </Fact>
            <Fact label="Invoice date" field="date" highlight={highlight}>
              <span className="font-mono">{formatDate(invoice.date)}</span>
            </Fact>
            <div className="col-span-2">
              <Fact label="Description" highlight={highlight}>
                {invoice.description}
              </Fact>
            </div>
            <Fact label="Category" field="category" highlight={highlight}>
              <span className="capitalize">{invoice.category}</span>
            </Fact>
            <Fact label="Default cost center" highlight={highlight}>
              {costCenterLabel(invoice.defaultCostCenter)}
            </Fact>
          </div>
        </section>

        <section className="rounded-lg border-2 border-slate-300 bg-white p-5">
          <h2 className="mb-3 text-2xl font-bold">Coding</h2>
          <div className="flex flex-col gap-3">
            <label data-erp-field="cost_center" className={`block p-2 ${hl("cost_center")}`}>
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">Cost center</span>
              <select
                name="cost_center"
                className={inputClass}
                value={invoice.draft.costCenter}
                disabled={locked}
                onChange={(e) => changeCostCenter(e.target.value)}
              >
                {COST_CENTERS.map((cc) => (
                  <option key={cc.code} value={cc.code}>
                    {cc.code} {cc.name}
                  </option>
                ))}
              </select>
            </label>
            <label data-erp-field="asset_number" className={`block p-2 ${hl("asset_number")}`}>
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">Asset number</span>
              <input
                name="asset_number"
                type="text"
                autoComplete="off"
                placeholder="(empty)"
                className={`${inputClass} font-mono`}
                value={invoice.draft.assetNumber}
                disabled={locked}
                onChange={(e) => changeText("assetNumber", e.target.value)}
                onBlur={() => flush("assetNumber")}
              />
            </label>
            <label data-erp-field="note" className={`block p-2 ${hl("note")}`}>
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">Posting note (optional)</span>
              <input
                name="note"
                type="text"
                autoComplete="off"
                className={`${inputClass} text-xl`}
                value={invoice.draft.note}
                disabled={locked}
                onChange={(e) => changeText("note", e.target.value)}
                onBlur={() => flush("note")}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 border-t-2 border-slate-200 pt-4">
            {locked ? (
              <>
                <div className="text-xl font-semibold">
                  Invoice is {STATUS_LABEL[invoice.status].toLowerCase()}. Cost center {costCenterLabel(invoice.saved.costCenter)}
                  {invoice.saved.assetNumber ? `, asset number ${invoice.saved.assetNumber}` : ", no asset number"}.
                </div>
                <button type="button" onClick={() => act("reopen")} className="rounded border-2 border-slate-900 bg-white px-4 py-2 text-lg font-semibold">
                  Reopen
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-erp-field="save"
                  onClick={requestPost}
                  className={`rounded bg-green-700 px-6 py-3 text-xl font-bold text-white hover:bg-green-800 ${hl("save")}`}
                >
                  Post
                </button>
                <button
                  type="button"
                  data-erp-field="hold"
                  onClick={() => act("hold")}
                  className={`rounded bg-amber-500 px-6 py-3 text-xl font-bold text-black hover:bg-amber-600 ${hl("hold")}`}
                >
                  Hold
                </button>
                <button
                  type="button"
                  data-erp-field="send_for_approval"
                  onClick={() => act("send_for_approval")}
                  className={`rounded bg-blue-700 px-6 py-3 text-xl font-bold text-white hover:bg-blue-800 ${hl("send_for_approval")}`}
                >
                  Send for second approval
                </button>
              </>
            )}
          </div>
          {confirming && !locked && (
            <div role="dialog" aria-label="Confirm posting" className="mt-4 rounded-lg border-4 border-green-700 bg-green-50 p-5">
              <div className="text-2xl font-bold">Post invoice {invoice.id}?</div>
              <div className="mt-2 text-xl">
                {invoice.supplier.name}, {formatEUR(invoice.amount)}. Cost center {costCenterLabel(invoice.draft.costCenter)}
                {invoice.draft.assetNumber ? `, asset number ${invoice.draft.assetNumber}` : ", no asset number"}.
              </div>
              <div className="mt-1 text-lg text-slate-700">Not posted yet. Posting cannot be undone without reopening.</div>
              <div className="mt-4 flex gap-3">
                <button type="button" data-erp-field="confirm_save" onClick={confirmPost} className="rounded bg-green-700 px-6 py-3 text-xl font-bold text-white hover:bg-green-800">
                  Confirm posting
                </button>
                <button type="button" onClick={cancelPost} className="rounded border-2 border-slate-900 bg-white px-6 py-3 text-xl font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section data-erp-field="purchase_order" className={`rounded-lg border-2 border-slate-300 bg-white p-5 ${hl("purchase_order")}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Purchase order</h2>
            <button type="button" onClick={togglePo} className="rounded border-2 border-slate-900 bg-white px-4 py-2 text-lg font-semibold">
              {showPo ? "Hide purchase order" : "Show purchase order"}
            </button>
          </div>
          {showPo &&
            (po ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Fact label="PO number" highlight={null}>
                  <span className="font-mono text-2xl">{po.number}</span>
                </Fact>
                <Fact label="PO amount" highlight={null}>
                  <span className="font-mono text-2xl">{formatEUR(po.amount)}</span>
                </Fact>
                <div className="col-span-2">
                  <Fact label="Ordered" highlight={null}>
                    {po.description}
                  </Fact>
                </div>
                <div className="col-span-2">
                  <Fact label="Goods receipt" highlight={null}>
                    {po.goodsReceipt}
                  </Fact>
                </div>
                <div className="col-span-2">
                  <Fact label="Invoice amount vs PO amount" highlight={null}>
                    {po.amount === invoice.amount
                      ? "Amounts are equal"
                      : `Difference of ${formatEUR(Math.abs(po.amount - invoice.amount))}`}
                  </Fact>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xl font-semibold">No purchase order linked to this invoice.</p>
            ))}
        </section>

        <section data-erp-field="supplier_history" className={`rounded-lg border-2 border-slate-300 bg-white p-5 ${hl("supplier_history")}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Supplier history</h2>
            <button type="button" onClick={toggleHistory} className="rounded border-2 border-slate-900 bg-white px-4 py-2 text-lg font-semibold">
              {showHistory ? "Hide supplier history" : "Show supplier history"}
            </button>
          </div>
          {showHistory &&
            (invoice.history.length > 0 ? (
              <div className="overflow-x-auto">
              <table className="mt-3 w-full border-collapse text-left text-lg">
                <thead>
                  <tr className="border-b-2 border-slate-900 text-sm uppercase tracking-wide text-slate-600">
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2">Paid on</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.history.map((h) => (
                    <tr key={h.id} className="border-b border-slate-300">
                      <td className="py-2 pr-3 font-mono font-bold">{h.id}</td>
                      <td className="py-2 pr-3 font-mono">{formatDate(h.date)}</td>
                      <td className="py-2 pr-3">{h.description}</td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold">{formatEUR(h.amount)}</td>
                      <td className="py-2 font-mono">{formatDate(h.paidDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="mt-3 text-xl font-semibold">No earlier invoices from {invoice.supplier.name}.</p>
            ))}
        </section>
      </div>
    </div>
  );
}
