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
  // strings, so cost center "0400" is not equal to "400".
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
  invoiceId?: string;
  // Set when the event was ignored, with the reason.
  skipped?: string;
};

// Actions that park the case without booking it. A wrong field value is not
// yet a problem when one of these is pressed.
const NON_POSTING_ACTIONS = new Set(["hold", "cancel", "close", "back"]);

export function invoiceIdOf(e: ScreenEvent): string | undefined {
  return e.facts?.invoice_id ?? (e.entity?.type === "invoice" ? e.entity.id : undefined);
}

// Latest known facts for the event's invoice: earlier events first, the event
// itself last. DOM events carry full facts, so for them this is a no-op.
export function mergedFacts(event: ScreenEvent, history: ScreenEvent[]): CaseFacts {
  const id = invoiceIdOf(event);
  let facts: CaseFacts = {};
  if (id) {
    for (const h of history) {
      if (h.id !== event.id && h.t <= event.t && invoiceIdOf(h) === id && h.facts) facts = { ...facts, ...h.facts };
    }
  }
  return { ...facts, ...(event.facts ?? {}) };
}

// Whether guardrails the rules left undecided are worth a model call for this
// event. Only the two moments where a late answer is still useful: an invoice
// was just opened, or an action waits in the confirmation step. Field changes
// and committed actions are left to the rules.
export function wantsModelCheck(e: Pick<ScreenEvent, "kind" | "action" | "committed" | "entity" | "facts">): boolean {
  if (e.kind === "open") return Boolean(e.facts?.invoice_id ?? (e.entity?.type === "invoice" ? e.entity.id : undefined));
  return e.kind === "action" && Boolean(e.action) && e.committed !== true;
}

const eur = (n: number) => `EUR ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function describeCase(f: CaseFacts): string {
  const parts: string[] = [];
  if (f.amount !== undefined) parts.push(eur(f.amount));
  if (f.category) parts.push(f.category);
  let s = `invoice${f.invoice_id ? ` ${f.invoice_id}` : ""}`;
  if (parts.length) s += ` (${parts.join(", ")})`;
  if (f.supplier) s += ` from ${f.supplier}`;
  return s;
}

const ACTION_WORDS: Record<string, string> = {
  save: "post",
  hold: "put on hold",
  send_for_approval: "send for approval",
};
export const actionWord = (a: string) => ACTION_WORDS[a] ?? a.replace(/_/g, " ");

// The field the guardrail is about, for highlighting in the ERP.
export function guardrailField(g: Guardrail): string | undefined {
  if (!g.check) return undefined;
  const pick = (expr?: string) => (expr ? identifiers(expr).find((i) => i !== "action") : undefined);
  return pick(g.check.require) ?? pick(g.check.forbid) ?? pick(g.check.when);
}

export function checkEvent(workMap: WorkMap, event: ScreenEvent, history: ScreenEvent[]): CheckResult {
  const facts = mergedFacts(event, history);
  const invoiceId = invoiceIdOf(event) ?? facts.invoice_id;
  const result: CheckResult = { violations: [], atRisk: [], satisfied: [], undecided: [], facts, invoiceId };

  // DOM events are ground truth. When the ERP reports this invoice itself, a
  // late vision event about it must not trigger a second intervention.
  if (event.source === "vision") {
    const domCovers = history.some(
      (h) => h.source === "dom" && h.id !== event.id && (invoiceId ? invoiceIdOf(h) === invoiceId : true),
    );
    if (domCovers) return { ...result, skipped: "dom events cover this invoice" };
  }

  // Any event that carries an action is an attempt (uncommitted) or a
  // completed action (committed).
  const action = event.action;
  const isAction = Boolean(action);
  const committed = event.committed === true;
  const severity: Severity = committed ? "broken" : "about_to_break";

  // DOM facts are complete: a missing key means empty. Vision facts are
  // partial: a missing key means not known.
  const known =
    event.source === "dom" ? undefined : new Set<string>([...Object.keys(facts), "action"]);
  const state: Scope = { ...facts, action };
  const caseText = describeCase(facts);

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
            const current = field ? `${field.replace(/_/g, " ")} ${String(state[field] ?? "empty")}` : "the current values";
            if (isAction && !NON_POSTING_ACTIONS.has(action!)) {
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
          // Would the forbidden condition hold if the learner posted now?
          const f = evaluate(g.check.forbid, { ...state, action: "save" }, known);
          if (f === UNKNOWN) unknown = true;
          else if (f) unmet = true;
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
