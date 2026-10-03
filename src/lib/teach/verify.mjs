// Verification for the tutor's brain. Run from the repo root with Node 22
// while the dev server is up:
//   node src/lib/teach/verify.mjs
// Part 1 unit-tests the expression evaluator against the fixture guardrails.
// Part 2 creates a learner session and posts simulated ERP events to
// POST /api/teach/check, printing what the tutor would be told.

import { readFileSync } from "node:fs";
import { evaluate, identifiers, checkEvent, UNKNOWN } from "./check.ts";
import * as store from "../store.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const workMap = JSON.parse(readFileSync("fixtures/sessions/fixture_sabine/workmap.json", "utf8"));
const g = Object.fromEntries(workMap.guardrails.map((x) => [x.id, x]));

let failed = 0;
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

console.log("== Part 1: evaluator ==");
const eq = { category: "equipment", amount: 7200, cost_center: "4711", asset_number: "", supplier_known: true };
expect("g_01 when, equipment 7200", evaluate(g.g_01.check.when, eq), true);
expect("g_01 when, equipment 5000 (not over)", evaluate(g.g_01.check.when, { ...eq, amount: 5000 }), false);
expect("g_01 when, consumables 7200", evaluate(g.g_01.check.when, { ...eq, category: "consumables" }), false);
expect("g_01 require, 4711", evaluate(g.g_01.check.require, eq), false);
expect("g_01 require, 0400", evaluate(g.g_01.check.require, { ...eq, cost_center: "0400" }), true);
expect("g_01 require, '400' is not '0400'", evaluate(g.g_01.check.require, { ...eq, cost_center: "400" }), false);
expect("g_02 when, 0400", evaluate(g.g_02.check.when, { cost_center: "0400" }), true);
expect("g_02 forbid, save without asset number", evaluate(g.g_02.check.forbid, { action: "save", asset_number: "" }), true);
expect("g_02 forbid, save with asset number", evaluate(g.g_02.check.forbid, { action: "save", asset_number: "A-2300" }), false);
expect("g_02 forbid, hold without asset number", evaluate(g.g_02.check.forbid, { action: "hold" }), false);
expect("g_03 when, Brandt in December", evaluate(g.g_03.check.when, { supplier: "Brandt Industriebedarf", invoice_month: 12 }), true);
expect("g_03 when, Brandt in November", evaluate(g.g_03.check.when, { supplier: "Brandt Industriebedarf", invoice_month: 11 }), false);
expect("g_03 require, hold", evaluate(g.g_03.check.require, { action: "hold" }), true);
expect("g_03 require, save", evaluate(g.g_03.check.require, { action: "save" }), false);
expect("g_04 when, group company (bare identifier)", evaluate(g.g_04.check.when, { supplier_is_group_company: true }), true);
expect("g_04 when, not group company", evaluate(g.g_04.check.when, { supplier_is_group_company: false }), false);
expect("g_04 require, send_for_approval", evaluate(g.g_04.check.require, { action: "send_for_approval" }), true);
expect("g_05 when, unknown supplier", evaluate(g.g_05.check.when, { supplier_known: false }), true);
expect("g_05 when, known supplier", evaluate(g.g_05.check.when, { supplier_known: true }), false);
expect("g_05 forbid, save", evaluate(g.g_05.check.forbid, { action: "save" }), true);
expect("parentheses and ||", evaluate("(a == 1 || b == 2) && !c", { a: 0, b: 2, c: "" }), true);
expect("<= and >=", evaluate("amount >= 5000 && amount <= 5000", { amount: 5000 }), true);
expect("!= and double quotes", evaluate('category != "equipment"', { category: "services" }), true);
expect("partial facts: unknown identifier", evaluate(g.g_01.check.when, { category: "equipment" }, new Set(["category"])) === UNKNOWN, true);
expect("partial facts: false && unknown is false", evaluate(g.g_01.check.when, { category: "services" }, new Set(["category"])), false);
expect("identifiers", identifiers(g.g_02.check.forbid), ["action", "asset_number"]);
let threw = false;
try {
  evaluate("process.exit(1)", {});
} catch {
  threw = true;
}
expect("rejects anything outside the grammar", threw, true);
const t0 = performance.now();
for (let i = 0; i < 1000; i++) {
  checkEvent(workMap, { id: "x", t: 1, kind: "action", action: "save", summary: "", source: "dom", facts: { ...eq, invoice_id: "4480" } }, []);
}
console.log(`checkEvent over 5 guardrails: ${((performance.now() - t0) / 1000).toFixed(4)} ms per call`);

console.log("\n== Part 2: simulated learner session ==");
const session = await store.sessions.create({
  role: "learner",
  personName: "Lena",
  task: workMap.task,
  workMapSessionId: "fixture_sabine",
});
console.log(`learner session ${session.id} -> ${BASE}/teach/${session.id}`);

const INVOICES = {
  4480: { invoice_id: "4480", supplier: "Hartmann Fördertechnik GmbH", supplier_known: true, supplier_is_group_company: false, amount: 7200, category: "equipment", invoice_month: 12, cost_center: "4711", asset_number: "", status: "open" },
  4482: { invoice_id: "4482", supplier: "Reuter Messtechnik", supplier_known: false, supplier_is_group_company: false, amount: 2300, category: "services", invoice_month: 12, cost_center: "4711", asset_number: "", status: "open" },
  4483: { invoice_id: "4483", supplier: "Schwarz Betriebsbedarf", supplier_known: true, supplier_is_group_company: false, amount: 900, category: "consumables", invoice_month: 12, cost_center: "4711", asset_number: "", status: "open" },
};

let t = 0;
let n = 0;
async function send(label, invoice, patch, ev) {
  t += 6000;
  n += 1;
  const facts = { ...INVOICES[invoice], ...patch };
  INVOICES[invoice] = facts;
  const event = { id: `sim_${String(n).padStart(2, "0")}`, t, source: "dom", entity: { type: "invoice", id: String(invoice) }, facts, ...ev };
  const res = await fetch(`${BASE}/api/teach/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ learnerSessionId: session.id, event, persist: true, useModel: false }),
  });
  const out = await res.json();
  console.log(`\n[${event.id}] ${label}`);
  console.log(`  event: ${event.kind}${event.action ? ` ${event.action}` : ""}${event.field ? ` ${event.field}=${event.after}` : ""} committed=${event.committed === true}`);
  if (!res.ok) {
    failed++;
    console.log(`  HTTP ${res.status}: ${JSON.stringify(out)}`);
    return out;
  }
  console.log(`  at risk: ${out.atRisk.map((x) => x.id).join(", ") || "none"}   violations: ${out.violations.map((v) => `${v.guardrailId} (${v.severity})`).join(", ") || "none"}   decided by ${out.decidedBy} in ${out.ms} ms`);
  for (const v of out.violations) console.log(`  TUTOR <- ${v.instruction}`);
  if (out.prediction) console.log(`  TUTOR <- ${out.prediction.instruction}`);
  return out;
}
const ids = (out) => out.violations.map((v) => `${v.guardrailId}:${v.severity}`);

console.log("\n-- A. Invoice 4480, EUR 7,200 equipment, learner leaves opex 4711 and tries to post --");
let r = await send("open 4480 with default cost center 4711", 4480, {}, { kind: "open", summary: "Invoice 4480 opened" });
expect("open: g_01 at risk, no intervention, prediction asked", [r.atRisk.map((x) => x.id), ids(r), r.prediction?.stepId], [["g_01"], [], "s_03"]);
r = await send("opens the purchase order", 4480, {}, { kind: "navigate", summary: "Purchase order PO-8851 opened next to invoice 4480" });
expect("navigate: still no intervention", ids(r), []);
r = await send("presses Post, not saved yet", 4480, {}, { kind: "action", action: "save", committed: false, summary: "Post pressed on invoice 4480" });
expect("save attempt: g_01 fires before the save", ids(r), ["g_01:about_to_break"]);
expect("instruction carries Sabine's quote", r.violations[0]?.instruction.includes(g.g_01.quote.text), true);

console.log("\n-- B. Variant: learner picks another opex code --");
r = await send("changes cost center 4711 -> 4720", 4480, { cost_center: "4720" }, { kind: "field_change", field: "cost_center", before: "4711", after: "4720", committed: false, summary: "Cost center changed from 4711 to 4720" });
expect("wrong value set: g_01 fires on the field change", ids(r), ["g_01:about_to_break"]);

console.log("\n-- C. Correct path: recode to 0400, forget the asset number, then add it --");
r = await send("changes cost center -> 0400", 4480, { cost_center: "0400" }, { kind: "field_change", field: "cost_center", before: "4720", after: "0400", committed: false, summary: "Cost center changed from 4720 to 0400" });
expect("0400 set: g_01 satisfied, g_02 at risk, nothing said yet", [r.atRisk.map((x) => x.id), ids(r)], [["g_02"], []]);
r = await send("presses Post without an asset number", 4480, {}, { kind: "action", action: "save", committed: false, summary: "Post pressed on invoice 4480" });
expect("save attempt without asset number: g_02 fires", ids(r), ["g_02:about_to_break"]);
r = await send("enters asset number A-2305", 4480, { asset_number: "A-2305" }, { kind: "field_change", field: "asset_number", before: "", after: "A-2305", committed: false, summary: "Asset number set to A-2305" });
expect("asset number set: clean", [r.atRisk.map((x) => x.id), ids(r)], [[], []]);
r = await send("posts", 4480, { status: "posted" }, { kind: "action", action: "save", committed: true, summary: "Invoice 4480 posted" });
expect("post: clean", [r.atRisk.map((x) => x.id), ids(r)], [[], []]);

console.log("\n-- D. Invoice 4482, unknown supplier --");
r = await send("open 4482", 4482, {}, { kind: "open", summary: "Invoice 4482 opened" });
expect("open: g_05 at risk, no intervention", [r.atRisk.map((x) => x.id), ids(r)], [["g_05"], []]);
r = await send("presses Post, not saved yet", 4482, {}, { kind: "action", action: "save", committed: false, summary: "Post pressed on invoice 4482" });
expect("save attempt: g_05 fires", ids(r), ["g_05:about_to_break"]);
r = await send("puts it on hold instead", 4482, { status: "on_hold" }, { kind: "action", action: "hold", committed: true, summary: "Invoice 4482 put on hold" });
expect("hold: clean", ids(r), []);

console.log("\n-- E. Control: consumables, EUR 900, known supplier, 4711 --");
r = await send("open 4483", 4483, {}, { kind: "open", summary: "Invoice 4483 opened" });
expect("open: nothing at risk, no prediction", [r.atRisk.length, ids(r), r.prediction ?? null], [0, [], null]);
r = await send("presses Post, not saved yet", 4483, {}, { kind: "action", action: "save", committed: false, summary: "Post pressed on invoice 4483" });
expect("save attempt: no intervention", ids(r), []);
r = await send("posts", 4483, { status: "posted" }, { kind: "action", action: "save", committed: true, summary: "Invoice 4483 posted" });
expect("post: no intervention", ids(r), []);

console.log("\n-- F. Idempotence: the same event checked twice --");
const again = await fetch(`${BASE}/api/teach/check`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ learnerSessionId: session.id, useModel: false, event: { id: "sim_03", t: 18000, source: "dom", kind: "action", action: "save", committed: false, summary: "Post pressed on invoice 4480", entity: { type: "invoice", id: "4480" }, facts: { ...INVOICES[4480], cost_center: "4711", asset_number: "", status: "open" } } }),
}).then((x) => x.json());
expect("second check of sim_03 is marked repeat", again.violations.map((v) => v.repeat), [true]);

console.log("\n-- Scorecard --");
const sc = await fetch(`${BASE}/api/sessions/${session.id}/scorecard`, { method: "POST" }).then((x) => x.json());
for (const i of sc.items) console.log(`  ${i.status.padEnd(9)} ${i.id}  ${i.note}`);
console.log(`  mastered: ${JSON.stringify(sc.scorecard.mastered)}  practiceNext: ${JSON.stringify(sc.scorecard.practiceNext)}`);
console.log(`  interventions: ${sc.scorecard.interventions.map((i) => `${i.guardrailId}@${i.learnerEventId}=${i.outcome ?? "open"}`).join(", ")}`);
expect("scorecard: g_01 and g_02 to practice, g_05 to practice", sc.scorecard.practiceNext, ["g_01", "g_02", "g_05"]);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
