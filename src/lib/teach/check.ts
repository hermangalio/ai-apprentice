import type { CaseFacts, Guardrail, ScreenEvent, WorkMap } from "../types";

// Deterministic guardrail checking. This file has no runtime imports so it
// can be loaded by plain Node scripts as well as by Next.

// ---------------------------------------------------------------------------
// Expression evaluator (no eval, no Function)
// ---------------------------------------------------------------------------

// Result of an expression whose inputs are not all known (vision events with
// partial facts). Three-valued logic: false && unknown is false, and so on.
export const UNKNOWN = Symbol("unknown");
export type Value = string | number | boolean | null | undefined | typeof UNKNOWN;

type Node =
  | { k: "lit"; v: string | number | boolean | null }
  | { k: "id"; name: string }
  | { k: "not"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

type Token = { t: "num" | "str" | "id" | "op"; v: string };

const OPS = ["&&", "||", "==", "!=", ">=", "<=", ">", "<", "!", "(", ")"];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new Error(`Unterminated string in: ${src}`);
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    // "===" and "!==" are accepted as "==" and "!=".
    if (src.startsWith("===", i) || src.startsWith("!==", i)) {
      out.push({ t: "op", v: src.slice(i, i + 2) });
      i += 3;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected character "${c}" in: ${src}`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peekOp = (v: string) => toks[p]?.t === "op" && toks[p].v === v;

  function primary(): Node {
    const tok = toks[p++];
    if (!tok) throw new Error(`Unexpected end of expression: ${src}`);
    if (tok.t === "num") return { k: "lit", v: Number(tok.v) };
    if (tok.t === "str") return { k: "lit", v: tok.v };
    if (tok.t === "id") {
      if (tok.v === "true") return { k: "lit", v: true };
      if (tok.v === "false") return { k: "lit", v: false };
      if (tok.v === "null" || tok.v === "undefined") return { k: "lit", v: null };
      return { k: "id", name: tok.v };
    }
    if (tok.v === "(") {
      const inner = or();
      if (!peekOp(")")) throw new Error(`Missing ")" in: ${src}`);
      p++;
      return inner;
    }
    throw new Error(`Unexpected "${tok.v}" in: ${src}`);
  }
  function unary(): Node {
    if (peekOp("!")) {
      p++;
      return { k: "not", a: unary() };
    }
    return primary();
  }
  function cmp(): Node {
    const a = unary();
    const tok = toks[p];
    if (tok?.t === "op" && ["==", "!=", ">", ">=", "<", "<="].includes(tok.v)) {
      p++;
      return { k: "bin", op: tok.v, a, b: unary() };
    }
    return a;
  }
  function and(): Node {
    let a = cmp();
    while (peekOp("&&")) {
      p++;
      a = { k: "bin", op: "&&", a, b: cmp() };
    }
    return a;
  }
  function or(): Node {
    let a = and();
    while (peekOp("||")) {
      p++;
      a = { k: "bin", op: "||", a, b: and() };
    }
    return a;
  }

  const ast = or();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}" in: ${src}`);
  return ast;
}

const cache = new Map<string, Node>();
function ast(src: string): Node {
  let n = cache.get(src);
  if (!n) cache.set(src, (n = parse(src)));
  return n;
}

const empty = (v: Value) => v === undefined || v === null || v === "";
const truthy = (v: Value) => !empty(v) && v !== false && v !== 0;

function asNumber(v: Value): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function equal(a: Value, b: Value): boolean {
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  // A number compared with a string compares numerically; two strings stay
  // strings, so a code "007" is not equal to "7".
  if (typeof a === "number" || typeof b === "number") {
    const x = asNumber(a);
    const y = asNumber(b);
    return x !== null && y !== null && x === y;
  }
  return a === b;
}

export type Scope = Record<string, unknown>;

// `known`: when given, identifiers outside it evaluate to UNKNOWN. When
// omitted, a missing identifier is simply empty (falsy).
function run(n: Node, scope: Scope, known?: Set<string>): Value {
  switch (n.k) {
    case "lit":
      return n.v;
    case "id":
      if (known && !known.has(n.name)) return UNKNOWN;
      return scope[n.name] as Value;
    case "not": {
      const a = run(n.a, scope, known);
      return a === UNKNOWN ? UNKNOWN : !truthy(a);
    }
    case "bin": {
      const a = run(n.a, scope, known);
      if (n.op === "&&") {
        if (a !== UNKNOWN && !truthy(a)) return false;
        const b = run(n.b, scope, known);
        if (b !== UNKNOWN && !truthy(b)) return false;
        return a === UNKNOWN || b === UNKNOWN ? UNKNOWN : true;
      }
      if (n.op === "||") {
        if (a !== UNKNOWN && truthy(a)) return true;
        const b = run(n.b, scope, known);
        if (b !== UNKNOWN && truthy(b)) return true;
        return a === UNKNOWN || b === UNKNOWN ? UNKNOWN : false;
      }
      const b = run(n.b, scope, known);
      if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
      if (n.op === "==") return equal(a, b);
      if (n.op === "!=") return !equal(a, b);
      const x = asNumber(a);
      const y = asNumber(b);
      if (x === null || y === null) return false;
      if (n.op === ">") return x > y;
      if (n.op === ">=") return x >= y;
      if (n.op === "<") return x < y;
      return x <= y;
    }
  }
}

// true | false | UNKNOWN. Throws on a syntax error.
export function evaluate(expr: string, scope: Scope, known?: Set<string>): boolean | typeof UNKNOWN {
  const v = run(ast(expr), scope, known);
  return v === UNKNOWN ? UNKNOWN : truthy(v);
}

export function identifiers(expr: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === "id") out.add(n.name);
    else if (n.k === "not") walk(n.a);
    else if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    }
  };
  walk(ast(expr));
  return [...out];
}

// ---------------------------------------------------------------------------
// Event checking
// ---------------------------------------------------------------------------

export type Severity = "about_to_break" | "broken";

export type Violation = {
  guardrail: Guardrail;
  severity: Severity;
  explanation: string;
};

export type CheckResult = {
  violations: Violation[];
  // Guardrails that apply to the case and are not satisfied yet.
  atRisk: Guardrail[];
  // Guardrails that apply to the case and are satisfied by this event.
  satisfied: Guardrail[];
  // Guardrails the deterministic path could not decide (no `check`, or facts
  // missing). Hand these to checkWithModel.
  undecided: Guardrail[];
  // The facts the check ran on (event facts merged over earlier ones).
  facts: CaseFacts;
  // The case the event is about: "C-110" and "candidate".
  caseId?: string;
  caseType: string;
  // Set when the event was ignored, with the reason.
  skipped?: string;
};

// Actions that neither move the case forward nor decide it. They are not
// judged against the guardrails. These are navigation words, not workflow words.
const NEUTRAL_ACTIONS = new Set(["cancel", "close", "back", "reopen"]);

const words = (key: string) => key.replace(/_/g, " ");

// The fact that names the case when the event has no entity: the first key
// that ends in "_id" ("candidate_id", "order_id", ...).
function idFact(facts?: CaseFacts): { type: string; id: string } | undefined {
  for (const [k, v] of Object.entries(facts ?? {})) {
    if (/_id$/.test(k) && v !== undefined && v !== "" && typeof v !== "boolean") {
      return { type: words(k.slice(0, -3)), id: String(v) };
    }
  }
  return undefined;
}

export function caseIdOf(e: Pick<ScreenEvent, "entity" | "facts">): string | undefined {
  return e.entity?.id ?? idFact(e.facts)?.id;
}

// "candidate", "order", ... or "case" when the event does not say.
export function caseTypeOf(e: Pick<ScreenEvent, "entity" | "facts">): string {
  return e.entity?.type ?? idFact(e.facts)?.type ?? "case";
}

// Latest known facts for the event's case: earlier events first, the event
// itself last. DOM events carry full facts, so for them this is a no-op.
export function mergedFacts(event: ScreenEvent, history: ScreenEvent[]): CaseFacts {
  const id = caseIdOf(event);
  let facts: CaseFacts = {};
  if (id) {
    for (const h of history) {
      if (h.id !== event.id && h.t <= event.t && caseIdOf(h) === id && h.facts) facts = { ...facts, ...h.facts };
    }
  }
  return { ...facts, ...(event.facts ?? {}) };
}

// Whether guardrails the rules left undecided are worth a model call for this
// event. Only the two moments where a late answer is still useful: a case was
// just opened, or an action waits in the confirmation step. Field changes and
// committed actions are left to the rules.
export function wantsModelCheck(e: Pick<ScreenEvent, "kind" | "action" | "committed" | "entity" | "facts">): boolean {
  if (e.kind === "open") return Boolean(caseIdOf(e));
  return e.kind === "action" && Boolean(e.action) && e.committed !== true;
}

// The fact names the Work Map's guardrails look at.
export function factNames(workMap: Pick<WorkMap, "guardrails">): string[] {
  const out = new Set<string>();
  for (const g of workMap.guardrails) {
    for (const expr of [g.check?.when, g.check?.require, g.check?.forbid]) {
      if (!expr) continue;
      try {
        for (const id of identifiers(expr)) if (id !== "action") out.add(id);
      } catch {
        // A check that does not parse names no facts.
      }
    }
  }
  return [...out];
}

// The facts of a case as short readable parts, in the order the facts come:
// "Marco Rossi", "degree MSc", "final grade 4.25", "track standard",
// "no interviewer". Ids, the status, and flags that are false are left out.
// An empty fact is only mentioned when a guardrail looks at it (`relevant`).
export function caseParts(f: CaseFacts, relevant: readonly string[] = []): string[] {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === "id" || /_id$/.test(k) || k === "status" || v === false) continue;
    if (v === undefined || v === "") {
      if (relevant.includes(k)) parts.push(`no ${words(k)}`);
    } else if (v === true) parts.push(words(k));
    else if (k === "name") parts.push(String(v));
    else parts.push(`${words(k)} ${v}`);
  }
  return parts;
}

// "candidate C-110 (Marco Rossi, university ETH Zurich, degree MSc, ...)".
export function describeCase(f: CaseFacts, opts: { type?: string; id?: string; relevant?: readonly string[] } = {}): string {
  const found = idFact(f);
  const type = opts.type ?? found?.type ?? "case";
  const id = opts.id ?? found?.id;
  const parts = caseParts(f, opts.relevant);
  return `${id ? `${type} ${id}` : `the ${type}`}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

// The action name as it is said, with underscores as spaces.
export const actionWord = (a: string) => words(a);

// The action names an expression compares `action` with: "action == 'hold'"
// gives ["hold"].
export function actionLiterals(expr: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === "not") walk(n.a);
    else if (n.k === "bin") {
      if (n.op === "==") {
        const [a, b] = n.a.k === "id" ? [n.a, n.b] : [n.b, n.a];
        if (a.k === "id" && a.name === "action" && b.k === "lit" && typeof b.v === "string") out.add(b.v);
      }
      walk(n.a);
      walk(n.b);
    }
  };
  walk(ast(expr));
  return [...out];
}

// Actions that some guardrail of the map asks for ("action == 'hold'"). They
// hand the case to someone else instead of completing it, so a field value
// that is still wrong is not judged when one of them is pressed.
function handOffActions(workMap: Pick<WorkMap, "guardrails">): Set<string> {
  const out = new Set<string>();
  for (const g of workMap.guardrails) {
    if (!g.check?.require) continue;
    try {
      for (const a of actionLiterals(g.check.require)) out.add(a);
    } catch {
      // Left to the model.
    }
  }
  return out;
}

// The fact names a guardrail's check looks at, most specific first: what it
// requires, what it forbids, then when it applies.
export function guardrailFields(g: Guardrail): string[] {
  const out: string[] = [];
  for (const expr of [g.check?.require, g.check?.forbid, g.check?.when]) {
    if (!expr) continue;
    try {
      for (const id of identifiers(expr)) if (id !== "action" && !out.includes(id)) out.push(id);
    } catch {
      // A check that does not parse names no fields.
    }
  }
  return out;
}

// The field the guardrail is about.
export function guardrailField(g: Guardrail): string | undefined {
  return guardrailFields(g)[0];
}

const tokens = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
function related(a: string, b: string): boolean {
  for (const x of tokens(a)) {
    for (const y of tokens(b)) {
      let n = 0;
      while (n < x.length && n < y.length && x[n] === y[n]) n++;
      if (n >= 5 || (n === x.length && n === y.length)) return true;
    }
  }
  return false;
}

// The element to highlight for a guardrail, chosen from the names the
// application on screen says it can highlight. A fact of the check with the
// same name wins, then one with a related name ("employer_is_partner" and
// "current_employer"), then the button of an action the check names.
export function highlightField(g: Guardrail, available: readonly string[]): string | undefined {
  const fields = guardrailFields(g);
  const exact = fields.find((f) => available.includes(f));
  if (exact) return exact;
  for (const f of fields) {
    const near = available.find((a) => related(f, a));
    if (near) return near;
  }
  for (const expr of [g.check?.forbid, g.check?.require]) {
    if (!expr) continue;
    try {
      const button = actionLiterals(expr).find((a) => available.includes(a));
      if (button) return button;
    } catch {
      // Nothing to highlight.
    }
  }
  return undefined;
}

export function checkEvent(workMap: WorkMap, event: ScreenEvent, history: ScreenEvent[]): CheckResult {
  const facts = mergedFacts(event, history);
  const caseId = caseIdOf(event) ?? caseIdOf({ facts });
  const caseType = event.entity?.type ?? caseTypeOf({ facts });
  const result: CheckResult = { violations: [], atRisk: [], satisfied: [], undecided: [], facts, caseId, caseType };

  // DOM events are ground truth. When the application reports this case
  // itself, a late vision event about it must not trigger a second intervention.
  if (event.source === "vision") {
    const domCovers = history.some(
      (h) => h.source === "dom" && h.id !== event.id && (caseId ? caseIdOf(h) === caseId : true),
    );
    if (domCovers) return { ...result, skipped: "dom events cover this case" };
  }

  // Any event that carries an action is an attempt (uncommitted) or a
  // completed action (committed). Neutral actions are not judged.
  const action = event.action && !NEUTRAL_ACTIONS.has(event.action) ? event.action : undefined;
  const isAction = Boolean(action);
  const handOff = handOffActions(workMap);
  const committed = event.committed === true;
  const severity: Severity = committed ? "broken" : "about_to_break";

  // DOM facts are complete: a missing key means empty. Vision facts are
  // partial: a missing key means not known.
  const known =
    event.source === "dom" ? undefined : new Set<string>([...Object.keys(facts), "action"]);
  const state: Scope = { ...facts, action };
  const caseText = describeCase(facts, { type: caseType, id: caseId, relevant: factNames(workMap) });

  for (const g of workMap.guardrails) {
    if (!g.check) {
      result.undecided.push(g);
      continue;
    }
    let applies: boolean | typeof UNKNOWN;
    let unmet = false; // applies and not satisfied
    let violated = false;
    let unknown = false;
    let what = "";
    try {
      applies = evaluate(g.check.when, state, known);
      if (applies === UNKNOWN) {
        result.undecided.push(g);
        continue;
      }
      if (!applies) continue;

      if (g.check.require) {
        const ids = identifiers(g.check.require);
        if (ids.includes("action")) {
          // The rule asks for a specific action; it can only be judged when
          // an action is attempted.
          if (!isAction) unmet = true;
          else {
            const r = evaluate(g.check.require, state, known);
            if (r === UNKNOWN) unknown = true;
            else if (!r) {
              unmet = violated = true;
              what = committed
                ? `The learner chose to ${actionWord(action!)} ${caseText}.`
                : `The learner is about to ${actionWord(action!)} ${caseText}.`;
            }
          }
        } else {
          const r = evaluate(g.check.require, state, known);
          if (r === UNKNOWN) unknown = true;
          else if (!r) {
            unmet = true;
            const field = ids[0];
            const current = field ? `${words(field)} ${String(state[field] ?? "") || "empty"}` : "the current values";
            if (isAction && !handOff.has(action!)) {
              violated = true;
              what = committed
                ? `The learner chose to ${actionWord(action!)} ${caseText} with ${current}.`
                : `The learner is about to ${actionWord(action!)} ${caseText} with ${current}.`;
            } else if (event.kind === "field_change" && event.field && ids.includes(event.field)) {
              violated = true;
              what = `The learner set ${current} on ${caseText}.`;
            }
          }
        }
      }

      if (g.check.forbid && !unknown) {
        if (isAction) {
          const f = evaluate(g.check.forbid, state, known);
          if (f === UNKNOWN) unknown = true;
          else if (f) {
            unmet = violated = true;
            what = committed
              ? `The learner chose to ${actionWord(action!)} ${caseText}.`
              : `The learner is about to ${actionWord(action!)} ${caseText}.`;
          }
        } else {
          // Would the forbidden condition hold if the learner now pressed an
          // action the rule names?
          const named = actionLiterals(g.check.forbid);
          const tries = named.length ? named.map((a) => ({ ...state, action: a })) : [state];
          const outcomes = tries.map((s) => evaluate(g.check!.forbid!, s, known));
          if (outcomes.includes(true)) unmet = true;
          else if (outcomes.includes(UNKNOWN)) unknown = true;
        }
      }
    } catch {
      // A check that does not parse is left to the model.
      result.undecided.push(g);
      continue;
    }

    if (unknown) {
      result.undecided.push(g);
      continue;
    }
    if (violated) {
      result.violations.push({ guardrail: g, severity, explanation: `${what} Rule: ${g.rule}` });
    }
    if (unmet) result.atRisk.push(g);
    else result.satisfied.push(g);
  }

  return result;
}
