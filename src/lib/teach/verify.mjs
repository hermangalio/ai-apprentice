// Verification for the tutor's brain. Run from the repo root with Node 22
// while the dev server is up:
//   node src/lib/teach/verify.mjs
// Part 1 unit-tests the expression evaluator and the generic case helpers
// against the fixture guardrails (hiring) and against a made-up map from
// another workflow.
// Part 2 creates a learner session and posts simulated sandbox events to
// POST /api/teach/check, printing what the tutor would be told.
// Part 3 removes one guardrail's `check` from a copy of the fixture map and
// shows the rule result first and the model's finding second. It calls the
// model; set SKIP_MODEL=1 to leave it out.

import { readFileSync } from "node:fs";
import {
  evaluate,
  identifiers,
  actionLiterals,
  checkEvent,
  describeCase,
  factNames,
  guardrailField,
  highlightField,
  wantsModelCheck,
  UNKNOWN,
} from "./check.ts";
import { createCueTracker, createOnce, createPendingSpeech, isTypingPing } from "./cues.ts";
import * as store from "../store.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const workMap = JSON.parse(readFileSync("fixtures/sessions/fixture_sabine/workmap.json", "utf8"));
const g = Object.fromEntries(workMap.guardrails.map((x) => [x.id, x]));
const who = workMap.expertName;

let failed = 0;
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

// The learner set of the sandbox (src/lib/erp/seed.ts), as the facts it sends.
const CASES = {
  "C-110": { candidate_id: "C-110", name: "Marco Rossi", role: "ML Engineer", university: "ETH Zurich", degree: "PhD", years_experience: 5, has_production_ml: true, salary_expectation: 135000, referred_by_employee: false, current_employer: "Bank Limmat AG", employer_is_partner: false, track: "standard", interviewer: "", status: "open" },
  "C-111": { candidate_id: "C-111", name: "Sara Keller", role: "ML Engineer", university: "UZH", degree: "MSc", years_experience: 3, has_production_ml: false, salary_expectation: 115000, referred_by_employee: false, current_employer: "Medisana Insights AG", employer_is_partner: false, track: "standard", interviewer: "", status: "open" },
  "C-112": { candidate_id: "C-112", name: "David Chen", role: "ML Engineer", university: "ETH Zurich", degree: "MSc", years_experience: 2, has_production_ml: false, salary_expectation: 118000, referred_by_employee: false, current_employer: "Helvetia Ventures", employer_is_partner: true, track: "standard", interviewer: "", status: "open" },
  "C-113": { candidate_id: "C-113", name: "Lea Fischer", role: "ML Engineer", university: "ETH Zurich", degree: "BSc", years_experience: 1, has_production_ml: false, salary_expectation: 95000, referred_by_employee: false, current_employer: "Alpenblick Software AG", employer_is_partner: false, track: "standard", interviewer: "", status: "open" },
};
const HIGHLIGHTABLE = ["track", "interviewer", "university", "work_history", "referral", "current_employer", "advance", "hold", "escalate", "reject"];

console.log("== Part 1: evaluator ==");
const marco = CASES["C-110"];
expect(`expert name comes from the Work Map`, who, "Emilie");
expect("g_01 when, 5 years of production ML", evaluate(g.g_01.check.when, marco), true);
expect("g_01 when, exactly 3 years", evaluate(g.g_01.check.when, { ...marco, years_experience: 3 }), true);
expect("g_01 when, 2 years", evaluate(g.g_01.check.when, { ...marco, years_experience: 2 }), false);
expect("g_01 when, 5 years but no production ML", evaluate(g.g_01.check.when, { ...marco, has_production_ml: false }), false);
expect("g_01 require, track standard", evaluate(g.g_01.check.require, marco), false);
expect("g_01 require, track fast", evaluate(g.g_01.check.require, { ...marco, track: "fast" }), true);
expect("g_01 require, track research", evaluate(g.g_01.check.require, { ...marco, track: "research" }), false);
expect("g_02 when, fast track", evaluate(g.g_02.check.when, { track: "fast" }), true);
expect("g_02 when, standard loop", evaluate(g.g_02.check.when, { track: "standard" }), false);
expect("g_02 forbid, advance without interviewer", evaluate(g.g_02.check.forbid, { action: "advance", interviewer: "" }), true);
expect("g_02 forbid, advance with interviewer", evaluate(g.g_02.check.forbid, { action: "advance", interviewer: "Reto" }), false);
expect("g_02 forbid, hold without interviewer", evaluate(g.g_02.check.forbid, { action: "hold" }), false);
expect("g_03 when, UZH", evaluate(g.g_03.check.when, { university: "UZH" }), true);
expect("g_03 when, ETH Zurich", evaluate(g.g_03.check.when, { university: "ETH Zurich" }), false);
expect("g_03 require, hold", evaluate(g.g_03.check.require, { action: "hold" }), true);
expect("g_03 require, advance", evaluate(g.g_03.check.require, { action: "advance" }), false);
expect("g_04 when, referred (bare identifier)", evaluate(g.g_04.check.when, { referred_by_employee: true }), true);
expect("g_04 when, not referred", evaluate(g.g_04.check.when, { referred_by_employee: false }), false);
expect("g_04 require, escalate", evaluate(g.g_04.check.require, { action: "escalate" }), true);
expect("g_04 require, advance", evaluate(g.g_04.check.require, { action: "advance" }), false);
expect("g_05 when, employer is a partner", evaluate(g.g_05.check.when, { employer_is_partner: true }), true);
expect("g_05 when, employer is not a partner", evaluate(g.g_05.check.when, { employer_is_partner: false }), false);
expect("g_05 forbid, advance", evaluate(g.g_05.check.forbid, { action: "advance" }), true);
expect("g_05 forbid, hold", evaluate(g.g_05.check.forbid, { action: "hold" }), false);
expect("g_05 forbid, escalate", evaluate(g.g_05.check.forbid, { action: "escalate" }), false);
expect("parentheses and ||", evaluate("(a == 1 || b == 2) && !c", { a: 0, b: 2, c: "" }), true);
expect("<= and >=", evaluate("n >= 3 && n <= 3", { n: 3 }), true);
expect("!= and double quotes", evaluate('track != "fast"', { track: "standard" }), true);
expect("two strings compare as strings", evaluate("code == '007'", { code: "7" }), false);
expect("partial facts: unknown identifier", evaluate(g.g_01.check.when, { has_production_ml: true }, new Set(["has_production_ml"])) === UNKNOWN, true);
expect("partial facts: false && unknown is false", evaluate(g.g_01.check.when, { has_production_ml: false }, new Set(["has_production_ml"])), false);
expect("identifiers", identifiers(g.g_02.check.forbid), ["action", "interviewer"]);
expect("action names in a check", [actionLiterals(g.g_02.check.forbid), actionLiterals(g.g_03.check.require), actionLiterals(g.g_01.check.require)], [["advance"], ["hold"], []]);
let threw = false;
try {
  evaluate("process.exit(1)", {});
} catch {
  threw = true;
}
expect("rejects anything outside the grammar", threw, true);
const t0 = performance.now();
for (let i = 0; i < 1000; i++) {
  checkEvent(workMap, { id: "x", t: 1, kind: "action", action: "advance", summary: "", source: "dom", entity: { type: "candidate", id: "C-110" }, facts: marco }, []);
}
console.log(`checkEvent over ${workMap.guardrails.length} guardrails: ${((performance.now() - t0) / 1000).toFixed(4)} ms per call`);

console.log("\n== Part 1a: nothing about the workflow is built in ==");
{
  expect("fact names come from the checks", factNames(workMap), ["has_production_ml", "years_experience", "track", "interviewer", "university", "referred_by_employee", "employer_is_partner"]);
  expect(
    "case description is built from the facts present",
    describeCase(marco, { type: "candidate", id: "C-110", relevant: factNames(workMap) }),
    "candidate C-110 (Marco Rossi, role ML Engineer, university ETH Zurich, degree PhD, years experience 5, has production ml, salary expectation 135000, current employer Bank Limmat AG, track standard, no interviewer)",
  );
  expect("case description without an entity uses the id fact", describeCase({ order_id: "7731", weight_kg: 42 }), "order 7731 (weight kg 42)");
  expect("guardrail field comes from the check", workMap.guardrails.map(guardrailField), ["track", "interviewer", "university", "referred_by_employee", "employer_is_partner"]);
  expect("highlight target is matched against what the sandbox can highlight", workMap.guardrails.map((x) => highlightField(x, HIGHLIGHTABLE)), ["track", "interviewer", "university", "referral", "current_employer"]);

  const ev = (over) => ({ id: "u", t: 10, summary: "", source: "dom", entity: { type: "candidate", id: "C-110" }, facts: marco, ...over });
  const v = (r) => r.violations.map((x) => `${x.guardrail.id}:${x.severity}`);
  let r = checkEvent(workMap, ev({ kind: "action", action: "advance", committed: false }), []);
  expect("any uncommitted action is an attempt: advance with track standard", v(r), ["g_01:about_to_break"]);
  expect("explanation is worded from the action name", r.violations[0]?.explanation.startsWith("The learner is about to advance candidate C-110 (Marco Rossi"), true);
  r = checkEvent(workMap, ev({ kind: "action", action: "reject", committed: false }), []);
  expect("an action the map never names is an attempt too: reject with track standard", v(r), ["g_01:about_to_break"]);
  r = checkEvent(workMap, ev({ kind: "action", action: "hold", committed: false }), []);
  expect("an action the map asks for elsewhere hands the case on: hold is not judged on the track", [v(r), r.atRisk.map((x) => x.id)], [[], ["g_01"]]);
  r = checkEvent(workMap, ev({ kind: "action", action: "reopen", committed: true, facts: { ...CASES["C-111"], status: "open" }, entity: { type: "candidate", id: "C-111" } }), []);
  expect("reopen is not judged", [v(r), r.atRisk.map((x) => x.id)], [[], ["g_03"]]);

  // A map from another workflow, with other fact and action names.
  const shipping = {
    guardrails: [
      { id: "x_01", stepId: "x", type: "limit", rule: "Over 30 kg goes by freight.", check: { when: "weight_kg > 30", require: "carrier == 'freight'" }, quote: { text: "" }, moment: {} },
      { id: "x_02", stepId: "x", type: "never", rule: "No customs form, no dispatch abroad.", check: { when: "abroad", forbid: "action == 'dispatch' && !customs_form" }, quote: { text: "" }, moment: {} },
    ],
  };
  const order = { order_id: "7731", weight_kg: 42, carrier: "parcel", abroad: true, customs_form: "" };
  r = checkEvent(shipping, { id: "o1", t: 1, kind: "open", summary: "", source: "dom", entity: { type: "order", id: "7731" }, facts: order }, []);
  expect("other workflow, open: both rules at risk, nothing said", [r.atRisk.map((x) => x.id), v(r), r.caseType, r.caseId], [["x_01", "x_02"], [], "order", "7731"]);
  r = checkEvent(shipping, { id: "o2", t: 2, kind: "action", action: "dispatch", committed: false, summary: "", source: "dom", entity: { type: "order", id: "7731" }, facts: order }, []);
  expect("other workflow, dispatch attempt: both fire", v(r), ["x_01:about_to_break", "x_02:about_to_break"]);
  expect("other workflow, wording", r.violations[0]?.explanation, "The learner is about to dispatch order 7731 (weight kg 42, carrier parcel, abroad, no customs form) with carrier parcel. Rule: Over 30 kg goes by freight.");
}

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
  expect("pending speech: dropped when the case is committed or left", pending.take(), null);

  // Cue tracker: when is the coach message in the sandbox cleared.
  const tr = createCueTracker();
  const res = (caseId, violations, atRisk, undecided = []) => ({
    caseId,
    violations: violations.map((id) => ({ guardrailId: id, repeat: false })),
    atRisk: atRisk.map((id) => ({ id })),
    undecided,
  });
  expect("tracker: open case, nothing settled", tr.update(res("C-110", [], ["g_01"]), { wall: 1000, kind: "open" }), { stale: false, settled: [], all: false });
  expect("tracker: advance attempt violates g_01", tr.update(res("C-110", ["g_01"], ["g_01"]), { wall: 2000, kind: "action", committed: false }).settled, []);
  expect("tracker: g_01 is open", tr.openIds(), ["g_01"]);
  expect("tracker: stored copy of an older event is stale", tr.update(res("C-110", [], ["g_01"]), { wall: 1000, kind: "open" }).stale, true);
  expect("tracker: wrong value again, still open", tr.update(res("C-110", ["g_01"], ["g_01"]), { wall: 3000, kind: "field_change" }).settled, []);
  expect("tracker: value corrected settles g_01", tr.update(res("C-110", [], ["g_02"]), { wall: 4000, kind: "field_change" }), { stale: false, settled: ["g_01"], all: false });
  tr.update(res("C-110", ["g_02"], ["g_02"]), { wall: 5000, kind: "action", committed: false });
  expect("tracker: commit settles everything", tr.update(res("C-110", ["g_02"], ["g_02"]), { wall: 6000, kind: "action", committed: true }), { stale: false, settled: ["g_02"], all: true });
  tr.update(res("C-111", ["g_03"], ["g_03"]), { wall: 7000, kind: "action", committed: false });
  expect("tracker: a model-decided guardrail stays open while undecided", tr.update(res("C-111", [], [], ["g_03"]), { wall: 8000, kind: "field_change" }).settled, []);
  expect("tracker: opening another case settles everything", tr.update(res("C-112", [], ["g_05"]), { wall: 9000, kind: "open" }), { stale: false, settled: ["g_03"], all: true });

  const once = createOnce(5000);
  expect("once: live event is new", once.first("C-110|action|Advance", 10000), true);
  expect("once: its stored copy is not", once.first("C-110|action|Advance", 10040), false);
  expect("once: the same step 6 s later is new", once.first("C-110|action|Advance", 16100), true);
  expect("typing ping is not a screen event", isTypingPing({ kind: "other", summary: "typing", field: "note" }), true);
  expect("a cancelled confirmation is a screen event", isTypingPing({ kind: "other", summary: "Hold of application C-111 cancelled" }), false);

  const inv = { entity: { type: "candidate", id: "C-111" } };
  expect("model follow-up: case opened", wantsModelCheck({ kind: "open", ...inv }), true);
  expect("model follow-up: queue opened", wantsModelCheck({ kind: "open" }), false);
  expect("model follow-up: confirmation step", wantsModelCheck({ kind: "action", action: "hold", committed: false, ...inv }), true);
  expect("model follow-up: case named only by an id fact", wantsModelCheck({ kind: "open", facts: { candidate_id: "C-111" } }), true);
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

let t = 0;
let n = 0;
async function send(label, id, patch, ev) {
  t += 6000;
  n += 1;
  const facts = { ...CASES[id], ...patch };
  CASES[id] = facts;
  const event = { id: `sim_${String(n).padStart(2, "0")}`, t, source: "dom", entity: { type: "candidate", id }, facts, ...ev };
  const res = await fetch(`${BASE}/api/teach/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ learnerSessionId: session.id, event, persist: true, useModel: false }),
  });
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    out = { error: text.slice(0, 300) };
  }
  console.log(`\n[${event.id}] ${label}`);
  console.log(`  event: ${event.kind}${event.action ? ` ${event.action}` : ""}${event.field ? ` ${event.field}=${event.after}` : ""} committed=${event.committed === true}`);
  if (!res.ok) {
    failed++;
    console.log(`  HTTP ${res.status}: ${JSON.stringify(out)}`);
    return { atRisk: [], violations: [], undecided: [] };
  }
  console.log(`  at risk: ${out.atRisk.map((x) => x.id).join(", ") || "none"}   violations: ${out.violations.map((v) => `${v.guardrailId} (${v.severity})`).join(", ") || "none"}   decided by ${out.decidedBy} in ${out.ms} ms`);
  for (const v of out.violations) console.log(`  TUTOR <- ${v.instruction}`);
  if (out.prediction) console.log(`  TUTOR <- ${out.prediction.instruction}`);
  return out;
}
const ids = (out) => out.violations.map((v) => `${v.guardrailId}:${v.severity}`);
const risk = (out) => out.atRisk.map((x) => x.id);
const requested = (id, action, word) => ({ kind: "action", action, committed: false, summary: `${word} of application ${id} requested, confirmation open` });

console.log("\n-- A. C-110 Marco Rossi, PhD ETH Zurich, 5 years of production ML, default track standard --");
let r = await send("open C-110 with the default track", "C-110", {}, { kind: "open", summary: "Application C-110 opened (Marco Rossi, PhD ETH Zurich, ML Engineer)" });
expect("open: g_01 at risk, no intervention, prediction asked for the track step", [risk(r), ids(r), r.prediction?.stepId, r.prediction?.guardrailId], [["g_01"], [], "s_03", "g_01"]);
expect("prediction question names the expert and the kind of case", r.prediction?.prompt, "Before you touch anything: what would Emilie do with this candidate, and why?");
expect("response names the case", [r.caseId, r.caseType], ["C-110", "candidate"]);
r = await send("opens the work history", "C-110", {}, { kind: "navigate", summary: "Work history of C-110 opened, 5 years of production ML at a bank visible" });
expect("navigate: still no intervention", ids(r), []);
r = await send("presses Advance with track standard, confirmation open", "C-110", {}, requested("C-110", "advance", "Advance"));
expect("advance attempt: g_01 fires before the commit", ids(r), ["g_01:about_to_break"]);
expect("question", r.violations[0]?.question, "Emilie would stop here. Why do you think?");
expect("instruction carries the expert's quote", r.violations[0]?.instruction.includes(`"Three years or more of machine learning in production goes straight to the founder interview. It doesn't matter what the default says."`), true);
expect("instruction is worded from the action name", r.violations[0]?.instruction.includes(`The learner pressed "advance" and is about to advance candidate C-110 (Marco Rossi`), true);
expect("instruction says nothing is confirmed yet", r.violations[0]?.instruction.includes("Speak now, before it is confirmed"), true);
expect("field for the highlight", r.violations[0]?.field, "track");

console.log("\n-- B. Variant: learner picks another wrong track --");
r = await send("changes track standard -> research", "C-110", { track: "research" }, { kind: "field_change", field: "track", before: "standard", after: "research", committed: false, summary: "Track changed from Standard loop to Research track" });
expect("wrong value set: g_01 fires on the field change", ids(r), ["g_01:about_to_break"]);

console.log("\n-- C. Fast track without an interviewer, then with one --");
r = await send("changes track -> fast", "C-110", { track: "fast" }, { kind: "field_change", field: "track", before: "research", after: "fast", committed: false, summary: "Track changed from Research track to Fast track" });
expect("fast track set: g_01 satisfied, g_02 at risk, nothing said yet", [risk(r), ids(r)], [["g_02"], []]);
r = await send("presses Advance without an interviewer, confirmation open", "C-110", {}, requested("C-110", "advance", "Advance"));
expect("advance attempt without interviewer: g_02 fires", ids(r), ["g_02:about_to_break"]);
expect("g_02 instruction says who to go to", r.violations[0]?.instruction.includes("Say who to go to: Reto."), true);
r = await send("sets interviewer Reto", "C-110", { interviewer: "Reto" }, { kind: "field_change", field: "interviewer", before: "", after: "Reto", committed: false, summary: "Interviewer set to Reto" });
expect("interviewer set: clean", [risk(r), ids(r)], [[], []]);
r = await send("presses Advance, confirmation open", "C-110", {}, requested("C-110", "advance", "Advance"));
expect("advance attempt: clean", [risk(r), ids(r)], [[], []]);
r = await send("confirms", "C-110", { status: "advanced" }, { kind: "action", action: "advance", committed: true, summary: "Application C-110 advanced to interview" });
expect("advance confirmed: clean", [risk(r), ids(r)], [[], []]);

console.log("\n-- D. C-111 Sara Keller, MSc UZH --");
r = await send("open C-111", "C-111", {}, { kind: "open", summary: "Application C-111 opened (Sara Keller, MSc UZH, ML Engineer)" });
expect("open: g_03 at risk, no intervention, prediction asked", [risk(r), ids(r), r.prediction?.stepId], [["g_03"], [], "s_06"]);
r = await send("presses Advance, confirmation open", "C-111", {}, requested("C-111", "advance", "Advance"));
expect("advance attempt: g_03 fires before the commit", ids(r), ["g_03:about_to_break"]);
expect("g_03 instruction carries the quote", r.violations[0]?.instruction.includes(g.g_03.quote.text), true);
r = await send("presses Hold instead, confirmation open", "C-111", {}, requested("C-111", "hold", "Hold"));
expect("hold attempt: clean, g_03 no longer at risk", [risk(r), ids(r)], [[], []]);
r = await send("confirms the hold", "C-111", { status: "on_hold" }, { kind: "action", action: "hold", committed: true, summary: "Application C-111 put on hold" });
expect("hold confirmed: clean", ids(r), []);
expect("every rule response lists what it left undecided", r.undecided, []);

console.log("\n-- E. C-112 David Chen, currently employed at an investor --");
r = await send("open C-112", "C-112", {}, { kind: "open", summary: "Application C-112 opened (David Chen, MSc ETH Zurich, ML Engineer)" });
expect("open: g_05 at risk, no intervention, prediction asked", [risk(r), ids(r), r.prediction?.guardrailId], [["g_05"], [], "g_05"]);
r = await send("presses Advance, confirmation open", "C-112", {}, requested("C-112", "advance", "Advance"));
expect("advance attempt: g_05 fires before the commit", ids(r), ["g_05:about_to_break"]);
expect("g_05 instruction says who to go to", r.violations[0]?.instruction.includes("Say who to go to: the CEO."), true);
// The map only forbids advancing this case and names the CEO as the person to
// ask. It does not ask for one action, so both ways of not advancing pass.
r = await send("presses Escalate instead, confirmation open", "C-112", {}, requested("C-112", "escalate", "Escalation"));
expect("escalate attempt: clean", [risk(r), ids(r)], [[], []]);
r = await send("presses Hold instead, confirmation open", "C-112", {}, requested("C-112", "hold", "Hold"));
expect("hold attempt: clean", [risk(r), ids(r)], [[], []]);
r = await send("confirms the hold", "C-112", { status: "on_hold" }, { kind: "action", action: "hold", committed: true, summary: "Application C-112 put on hold" });
expect("hold confirmed: clean", ids(r), []);

console.log("\n-- F. Control: C-113 Lea Fischer, BSc ETH Zurich, 1 year, standard loop is right --");
r = await send("open C-113", "C-113", {}, { kind: "open", summary: "Application C-113 opened (Lea Fischer, BSc ETH Zurich, ML Engineer)" });
expect("open: nothing at risk, no prediction", [r.atRisk.length, ids(r), r.prediction ?? null], [0, [], null]);
r = await send("presses Advance, confirmation open", "C-113", {}, requested("C-113", "advance", "Advance"));
expect("advance attempt: no intervention", ids(r), []);
r = await send("confirms", "C-113", { status: "advanced" }, { kind: "action", action: "advance", committed: true, summary: "Application C-113 advanced to interview" });
expect("advance confirmed: no intervention", ids(r), []);

console.log("\n-- G. Idempotence: the same event checked twice --");
const again = await fetch(`${BASE}/api/teach/check`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ learnerSessionId: session.id, useModel: false, event: { id: "sim_03", t: 18000, source: "dom", ...requested("C-110", "advance", "Advance"), entity: { type: "candidate", id: "C-110" }, facts: { ...CASES["C-110"], track: "standard", interviewer: "", status: "open" } } }),
}).then((x) => x.json());
expect("second check of sim_03 is marked repeat", again.violations?.map((v) => v.repeat), [true]);

console.log("\n-- Scorecard --");
const sc = await fetch(`${BASE}/api/sessions/${session.id}/scorecard`, { method: "POST" }).then((x) => x.json());
for (const i of sc.items ?? []) console.log(`  ${i.status.padEnd(9)} ${i.id}  ${i.note}`);
console.log(`  mastered: ${JSON.stringify(sc.scorecard?.mastered)}  practiceNext: ${JSON.stringify(sc.scorecard?.practiceNext)}`);
console.log(`  interventions: ${sc.scorecard?.interventions.map((i) => `${i.guardrailId}@${i.learnerEventId}=${i.outcome ?? "open"}`).join(", ")}`);
expect("scorecard: g_01, g_02, g_03 and g_05 to practice", sc.scorecard?.practiceNext, ["g_01", "g_02", "g_03", "g_05"]);
expect("scorecard: every intervention ended corrected", sc.scorecard?.interventions.map((i) => i.outcome), ["corrected", "corrected", "corrected", "corrected", "corrected"]);
expect("scorecard: g_04 did not come up", sc.items?.find((i) => i.id === "g_04")?.status, "not_seen");
expect("scorecard: notes name the case", sc.items?.find((i) => i.id === "g_03")?.note, "Caught before confirming on candidate C-111, then corrected. Not yet done without help.");

if (process.env.SKIP_MODEL === "1") {
  console.log("\n== Part 3 skipped (SKIP_MODEL=1) ==");
} else {
  console.log("\n== Part 3: a guardrail without a `check` (model fallback) ==");
  // A copy of the fixture map as a live-built map would look: g_03 has only
  // its rule text and the expert's quote.
  const expert = await store.sessions.create({ role: "expert", personName: workMap.expertName, task: `[test] ${workMap.task}` });
  await store.workMaps.set(expert.id, {
    ...workMap,
    sessionId: expert.id,
    guardrails: workMap.guardrails.map(({ check, ...rest }) => (rest.id === "g_03" ? rest : { ...rest, check })),
  });
  const learner = await store.sessions.create({ role: "learner", personName: "Lena", task: workMap.task, workMapSessionId: expert.id });
  console.log(`map copy ${expert.id} (g_03 without check), learner session ${learner.id}`);
  const sara = { ...CASES["C-111"], status: "open" };
  const post = async (event, useModel) => {
    const started = performance.now();
    const res = await fetch(`${BASE}/api/teach/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learnerSessionId: learner.id, event, persist: true, useModel }),
    });
    const out = await res.json().catch(() => ({}));
    console.log(`  ${useModel ? "model" : "rule "} pass: violations ${out.violations?.map((v) => `${v.guardrailId} (${v.severity}${v.repeat ? ", repeat" : ""})`).join(", ") || "none"}, undecided ${JSON.stringify(out.undecided)}, decided by ${out.decidedBy}, ${Math.round(performance.now() - started)} ms round trip`);
    return { violations: [], ...out };
  };
  const attempt = { id: "sim_m1", t: 6000, source: "dom", ...requested("C-111", "advance", "Advance"), entity: { type: "candidate", id: "C-111" }, facts: sara };
  console.log("\n[sim_m1] UZH application, learner presses Advance");
  let m = await post(attempt, false);
  expect("rule pass: no violation, g_03 reported undecided", [ids(m), m.undecided], [[], ["g_03"]]);
  m = await post(attempt, true);
  expect("model pass: g_03 fires before the commit", ids(m), ["g_03:about_to_break"]);
  expect("model pass: decided by the model, nothing left undecided", [m.decidedBy, m.undecided], ["model", []]);
  expect("model pass: the instruction carries the expert's quote", m.violations[0]?.instruction.includes(g.g_03.quote.text), true);

  const wrongTrack = { id: "sim_m2", t: 12000, source: "dom", ...requested("C-110", "advance", "Advance"), entity: { type: "candidate", id: "C-110" }, facts: { ...CASES["C-110"], track: "standard", interviewer: "", status: "open" } };
  console.log("\n[sim_m2] 5 years of production ML on the standard loop, learner presses Advance (rule violation plus an undecided guardrail)");
  m = await post(wrongTrack, false);
  expect("rule pass: g_01 fires at once", ids(m), ["g_01:about_to_break"]);
  const hold = { ...attempt, id: "sim_m3", t: 18000, ...requested("C-111", "hold", "Hold") };
  console.log("\n[sim_m3] UZH application, learner presses Hold (the right action)");
  m = await post(hold, true);
  expect("model pass: no intervention for the right action", ids(m), []);
  m = await post({ ...hold, id: "sim_m4", t: 24000, committed: true, summary: "Application C-111 put on hold", facts: { ...sara, status: "on_hold" } }, true);
  const state = await fetch(`${BASE}/api/teach/state?learnerSessionId=${learner.id}`).then((x) => x.json());
  expect("hold confirmed, model pass: the g_03 intervention is settled as corrected", state.interventions?.filter((i) => i.guardrailId === "g_03").map((i) => i.outcome), ["corrected"]);

  console.log("\n[sim_m2, again with the model]");
  m = await post(wrongTrack, true);
  expect("model pass: g_01 comes back as a repeat, so it is not spoken twice", m.violations.filter((v) => v.guardrailId === "g_01").map((v) => v.repeat), [true]);
  expect("model pass: g_03 does not fire on an ETH Zurich application", m.violations.some((v) => v.guardrailId === "g_03"), false);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
