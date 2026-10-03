// DOM event stream of the sandbox ERP.
// The ERP posts an ErpDomEvent on BroadcastChannel(ERP_CHANNEL) for every
// user step. Other tabs (capture, tutor) subscribe and treat it as ground truth.
// The ERP listens on BroadcastChannel(ERP_CONTROL) for ErpControlMessage.

import type { CaseFacts, ScreenEvent } from "@/lib/types";
import type { Invoice } from "./seed";

export const ERP_CHANNEL = "erp-events";
export const ERP_CONTROL = "erp-control";

// source is always "dom". wallTime is Date.now() in the ERP tab; the receiver
// converts it to session time `t` and assigns `id`.
export type ErpDomEvent = Omit<ScreenEvent, "id" | "t" | "frameId"> & { wallTime: number };

// "stop": the learner is about to do something the tutor wants to question;
// the ERP delays the confirm button for a few seconds. "hint": no delay.
export type ErpCoachSeverity = "stop" | "hint";

export type ErpControlMessage =
  | { type: "highlight"; field: string }
  | { type: "open_invoice"; id: string }
  // Tutor banner shown in the ERP tab. A new coach message replaces the one
  // on screen. `field` is highlighted for as long as the banner is shown.
  | { type: "coach"; text: string; field?: string; severity?: ErpCoachSeverity }
  | { type: "coach_clear" };

// Field names accepted by the "highlight" control message.
export const ERP_HIGHLIGHT_FIELDS = [
  "cost_center",
  "asset_number",
  "note",
  "supplier",
  "amount",
  "date",
  "category",
  "status",
  "purchase_order",
  "supplier_history",
  "save",
  "hold",
  "send_for_approval",
] as const;

// Facts of the invoice as currently shown on screen (unsaved edits included).
export function caseFacts(invoice: Invoice): CaseFacts {
  return {
    invoice_id: invoice.id,
    supplier: invoice.supplier.name,
    supplier_known: invoice.supplier.known,
    supplier_is_group_company: invoice.supplier.isGroupCompany,
    amount: invoice.amount,
    category: invoice.category,
    invoice_month: Number(invoice.date.slice(5, 7)),
    cost_center: invoice.draft.costCenter,
    asset_number: invoice.draft.assetNumber,
    status: invoice.status,
  };
}

export function formatEUR(amount: number): string {
  return "EUR " + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "2025-12-02" -> "02.12.2025"
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// "2025-12-02" -> "02.12."
export function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(ERP_CHANNEL);
  return channel;
}

export type ErpEventInput = Omit<ErpDomEvent, "wallTime" | "source" | "entity" | "facts">;

// Posts one event. When an invoice is given, entity and facts are filled from it.
export function emitErpEvent(input: ErpEventInput, invoice?: Invoice): ErpDomEvent {
  const event: ErpDomEvent = {
    ...input,
    source: "dom",
    wallTime: Date.now(),
    ...(invoice ? { entity: { type: "invoice", id: invoice.id }, facts: caseFacts(invoice) } : {}),
  };
  getChannel()?.postMessage(event);
  return event;
}

// Summary builders. Wording follows fixtures/sessions/fixture_sabine/events.json.

export function queueOpenedSummary(invoices: Invoice[]): string {
  const open = invoices.filter((i) => i.status === "open").length;
  return `Invoice queue opened, ${open} open invoice${open === 1 ? "" : "s"}`;
}

export function invoiceOpenedSummary(invoice: Invoice): string {
  return `Invoice ${invoice.id} opened (${invoice.supplier.name}, ${formatEUR(invoice.amount)}, dated ${formatDayMonth(invoice.date)})`;
}

export function poOpenedSummary(invoice: Invoice): string {
  if (!invoice.purchaseOrder) return `Purchase order panel opened for invoice ${invoice.id}, no purchase order linked`;
  return `Purchase order ${invoice.purchaseOrder.number} opened next to invoice ${invoice.id}`;
}

export function historyOpenedSummary(invoice: Invoice): string {
  const name = invoice.supplier.name;
  if (invoice.history.length === 0) return `Supplier history for ${name} opened, no earlier invoices`;
  const same = invoice.history.find((h) => h.amount === invoice.amount);
  const shown = same ?? invoice.history[0];
  return `Supplier history for ${name} opened, invoice ${shown.id} for ${formatEUR(shown.amount)} visible`;
}

const FIELD_LABELS: Record<string, string> = {
  cost_center: "Cost center",
  asset_number: "Asset number",
  note: "Posting note",
};

export function fieldChangeSummary(field: string, before: string, after: string): string {
  const label = FIELD_LABELS[field] ?? field;
  if (before === "") return `${label} set to ${after}`;
  if (after === "") return `${label} cleared (was ${before})`;
  return `${label} changed from ${before} to ${after}`;
}

export type ErpAction = "save" | "hold" | "send_for_approval" | "reopen";

// Actions that go through the confirmation box before anything is saved.
export type ErpConfirmAction = Exclude<ErpAction, "reopen">;

// Summary of the uncommitted action event sent when the confirmation box opens.
export function actionRequestedSummary(action: ErpConfirmAction, invoice: Invoice): string {
  switch (action) {
    case "save":
      return `Posting of invoice ${invoice.id} requested, confirmation open`;
    case "hold":
      return `Hold of invoice ${invoice.id} requested, confirmation open`;
    case "send_for_approval":
      return `Second approval of invoice ${invoice.id} requested, confirmation open`;
  }
}

export function actionCancelledSummary(action: ErpConfirmAction, invoice: Invoice): string {
  switch (action) {
    case "save":
      return `Posting of invoice ${invoice.id} cancelled`;
    case "hold":
      return `Hold of invoice ${invoice.id} cancelled`;
    case "send_for_approval":
      return `Second approval of invoice ${invoice.id} cancelled`;
  }
}

export function actionSummary(action: ErpAction, invoice: Invoice): string {
  switch (action) {
    case "save":
      return `Invoice ${invoice.id} posted`;
    case "hold":
      return `Invoice ${invoice.id} put on hold`;
    case "send_for_approval":
      return `Invoice ${invoice.id} sent for second approval`;
    case "reopen":
      return `Invoice ${invoice.id} reopened`;
  }
}
