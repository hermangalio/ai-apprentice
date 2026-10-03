// Verification for the tutor's brain. Run from the repo root with Node 22
// while the dev server is up:
//   node src/lib/teach/verify.mjs
// Part 1 unit-tests the expression evaluator against the fixture guardrails.
// Part 2 creates a learner session and posts simulated ERP events to
// POST /api/teach/check, printing what the tutor would be told.
// Part 3 removes one guardrail's `check` from a copy of the fixture map and
// shows the rule result first and the model's finding second. It calls the
// model; set SKIP_MODEL=1 to leave it out.

import { readFileSync } from "node:fs";
import { evaluate, identifiers, checkEvent, wantsModelCheck, UNKNOWN } from "./check.ts";
import { createCueTracker, createOnce, createPendingSpeech, isTypingPing } from "./cues.ts";
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

console.log("\n== Part 1b: panel bookkeeping (cues.ts) ==");
{
  // Pending speech: kept while the voice is off, dropped when settled or old.
  let clock = 0;
  const pending = createPendingSpeech(20000, () => clock);
  pending.set("INTERVENE g_03", { kind: "intervention", guardrailId: "g_03" });
  clock = 8000;
  expect("pending speech: spoken when the voice connects after 8 s", pending.take()?.instruction, "INTERVENE g_03");
  expect("pending speech: spoken once", pending.take(), null);
  pending.set("INTERVENE g_03", { kind: "intervention", guardrailId: "g_03" });
  clock += 21000;
  expect("pending speech: dropped after 21 s", pending.take(), null);
  pending.set("INTERVENE g_01", { kind: "intervention", guardrailId: "g_01" });
  pending.settle(["g_02"], false);
  expect("pending speech: another guardrail settled, still waiting", pending.waiting, true);
  pending.settle(["g_01"], false);
  expect("pending speech: dropped once the learner corrected it", pending.take(), null);
  pending.set("INTERVENE g_01", { kind: "intervention", guardrailId: "g_01" });
  pending.set("INTERVENE g_02", { kind: "intervention", guardrailId: "g_02" });
  expect("pending speech: only the latest is kept", pending.take()?.instruction, "INTERVENE g_02");
  pending.set("PREDICT s_03", { kind: "prediction", stepId: "s_03" });
  pending.settle([], true);
  expect("pending speech: dropped when the invoice is committed or left", pending.take(), null);

  // Cue tracker: when is the coach message in the ERP cleared.
  const tr = createCueTracker();
  const res = (invoiceId, violations, atRisk, undecided = []) => ({
    invoiceId,
    violations: violations.map((id) => ({ guardrailId: id, repeat: false })),
    atRisk: atRisk.map((id) => ({ id })),
    undecided,
  });
  expect("tracker: open invoice, nothing settled", tr.update(res("4480", [], ["g_01"]), { wall: 1000, kind: "open" }), { stale: false, settled: [], all: false });
  expect("tracker: post attempt violates g_01", tr.update(res("4480", ["g_01"], ["g_01"]), { wall: 2000, kind: "action", committed: false }).settled, []);
  expect("tracker: g_01 is open", tr.openIds(), ["g_01"]);
  expect("tracker: stored copy of an older event is stale", tr.update(res("4480", [], ["g_01"]), { wall: 1000, kind: "open" }).stale, true);
  expect("tracker: wrong value again, still open", tr.update(res("4480", ["g_01"], ["g_01"]), { wall: 3000, kind: "field_change" }).settled, []);
  expect("tracker: value corrected settles g_01", tr.update(res("4480", [], ["g_02"]), { wall: 4000, kind: "field_change" }), { stale: false, settled: ["g_01"], all: false });
  tr.update(res("4480", ["g_02"], ["g_02"]), { wall: 5000, kind: "action", committed: false });
  expect("tracker: commit settles everything", tr.update(res("4480", ["g_02"], ["g_02"]), { wall: 6000, kind: "action", committed: true }), { stale: false, settled: ["g_02"], all: true });
  tr.update(res("4481", ["g_03"], ["g_03"]), { wall: 7000, kind: "action", committed: false });
  expect("tracker: a model-decided guardrail stays open while undecided", tr.update(res("4481", [], [], ["g_03"]), { wall: 8000, kind: "field_change" }).settled, []);
  expect("tracker: opening another invoice settles everything", tr.update(res("4482", [], ["g_05"]), { wall: 9000, kind: "open" }), { stale: false, settled: ["g_03"], all: true });

  const once = createOnce(5000);
  expect("once: live event is new", once.first("4480|action|Post", 10000), true);
  expect("once: its stored copy is not", once.first("4480|action|Post", 10040), false);
  expect("once: the same step 6 s later is new", once.first("4480|action|Post", 16100), true);
  expect("typing ping is not a screen event", isTypingPing({ kind: "other", summary: "typing", field: "note" }), true);
  expect("a cancelled confirmation is a screen event", isTypingPing({ kind: "other", summary: "Hold of invoice 4481 cancelled" }), false);

  const inv = { entity: { type: "invoice", id: "4481" } };
  expect("model follow-up: invoice opened", wantsModelCheck({ kind: "open", ...inv }), true);
  expect("model follow-up: queue opened", wantsModelCheck({ kind: "open" }), false);
  expect("model follow-up: confirmation step", wantsModelCheck({ kind: "action", action: "hold", committed: false, ...inv }), true);
  expect("model follow-up: committed action", wantsModelCheck({ kind: "action", action: "hold", committed: true, ...inv }), false);
  expect("model follow-up: field change", wantsModelCheck({ kind: "field_change", ...inv }), false);
}

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
  4481: { invoice_id: "4481", supplier: "Brandt Industriebedarf", supplier_known: true, supplier_is_group_company: false, amount: 890, category: "consumables", invoice_month: 12, cost_center: "4711", asset_number: "", status: "open" },
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

console.log("\n-- G. Invoice 4481, Brandt in December: Hold and Send for second approval are two-step too --");
r = await send("open 4481", 4481, {}, { kind: "open", summary: "Invoice 4481 opened" });
expect("open: g_03 at risk, no intervention", [r.atRisk.map((x) => x.id), ids(r)], [["g_03"], []]);
r = await send("presses Send for second approval, not saved yet", 4481, {}, { kind: "action", action: "send_for_approval", committed: false, summary: "Second approval of invoice 4481 requested, confirmation open" });
expect("send-for-approval attempt: g_03 fires before the save", ids(r), ["g_03:about_to_break"]);
expect("instruction says nothing is saved yet", r.violations[0]?.instruction.includes("Speak now, before it is saved"), true);
r = await send("presses Hold instead, not saved yet", 4481, {}, { kind: "action", action: "hold", committed: false, summary: "Hold of invoice 4481 requested, confirmation open" });
expect("hold attempt: clean, g_03 no longer at risk", [r.atRisk.map((x) => x.id), ids(r)], [[], []]);
r = await send("confirms the hold", 4481, { status: "on_hold" }, { kind: "action", action: "hold", committed: true, summary: "Invoice 4481 put on hold" });
expect("hold confirmed: clean", ids(r), []);
expect("every rule response lists what it left undecided", r.undecided, []);

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
expect("scorecard: g_01, g_02, g_03 and g_05 to practice", sc.scorecard.practiceNext, ["g_01", "g_02", "g_03", "g_05"]);

if (process.env.SKIP_MODEL === "1") {
  console.log("\n== Part 3 skipped (SKIP_MODEL=1) ==");
} else {
  console.log("\n== Part 3: a guardrail without a `check` (model fallback) ==");
  // A copy of the fixture map as a live-built map would look: g_03 has only
  // its rule text and the expert's quote.
  const expert = await store.sessions.create({ role: "expert", personName: workMap.expertName, task: workMap.task });
  await store.workMaps.set(expert.id, {
    ...workMap,
    sessionId: expert.id,
    guardrails: workMap.guardrails.map(({ check, ...rest }) => (rest.id === "g_03" ? rest : { ...rest, check })),
  });
  const learner = await store.sessions.create({ role: "learner", personName: "Lena", task: workMap.task, workMapSessionId: expert.id });
  console.log(`map copy ${expert.id} (g_03 without check), learner session ${learner.id}`);
  const brandt = { ...INVOICES[4481], status: "open" };
  const post = async (event, useModel) => {
    const started = performance.now();
    const res = await fetch(`${BASE}/api/teach/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learnerSessionId: learner.id, event, persist: true, useModel }),
    });
    const out = await res.json();
    console.log(`  ${useModel ? "model" : "rule "} pass: violations ${out.violations?.map((v) => `${v.guardrailId} (${v.severity}${v.repeat ? ", repeat" : ""})`).join(", ") || "none"}, undecided ${JSON.stringify(out.undecided)}, decided by ${out.decidedBy}, ${Math.round(performance.now() - started)} ms round trip`);
    return out;
  };
  const attempt = { id: "sim_m1", t: 6000, source: "dom", kind: "action", action: "send_for_approval", committed: false, summary: "Second approval of invoice 4481 requested, confirmation open", entity: { type: "invoice", id: "4481" }, facts: brandt };
  console.log("\n[sim_m1] Brandt December invoice, learner presses Send for second approval");
  let m = await post(attempt, false);
  expect("rule pass: no violation, g_03 reported undecided", [ids(m), m.undecided], [[], ["g_03"]]);
  m = await post(attempt, true);
  expect("model pass: g_03 fires before the save", ids(m), ["g_03:about_to_break"]);
  expect("model pass: decided by the model, nothing left undecided", [m.decidedBy, m.undecided], ["model", []]);
  expect("model pass: the instruction carries Sabine's quote", m.violations[0]?.instruction.includes(g.g_03.quote.text), true);

  const wrongCode = { id: "sim_m2", t: 12000, source: "dom", kind: "action", action: "save", committed: false, summary: "Posting of invoice 4480 requested, confirmation open", entity: { type: "invoice", id: "4480" }, facts: { ...INVOICES[4480], cost_center: "4711", asset_number: "", status: "open" } };
  console.log("\n[sim_m2] Equipment invoice with opex code, learner presses Post (rule violation plus an undecided guardrail)");
  m = await post(wrongCode, false);
  expect("rule pass: g_01 fires at once", ids(m), ["g_01:about_to_break"]);
  const hold = { ...attempt, id: "sim_m3", t: 18000, action: "hold", summary: "Hold of invoice 4481 requested, confirmation open" };
  console.log("\n[sim_m3] Brandt December invoice, learner presses Hold (the right action)");
  m = await post(hold, true);
  expect("model pass: no intervention for the right action", ids(m), []);
  m = await post({ ...hold, id: "sim_m4", t: 24000, committed: true, summary: "Invoice 4481 put on hold", facts: { ...brandt, status: "on_hold" } }, true);
  const state = await fetch(`${BASE}/api/teach/state?learnerSessionId=${learner.id}`).then((x) => x.json());
  expect("hold confirmed, model pass: the g_03 intervention is settled as corrected", state.interventions.filter((i) => i.guardrailId === "g_03").map((i) => i.outcome), ["corrected"]);

  console.log("\n[sim_m2, again with the model]");
  m = await post(wrongCode, true);
  expect("model pass: g_01 comes back as a repeat, so it is not spoken twice", m.violations.filter((v) => v.guardrailId === "g_01").map((v) => v.repeat), [true]);
  expect("model pass: g_03 does not fire on a Hartmann invoice", m.violations.some((v) => v.guardrailId === "g_03"), false);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
