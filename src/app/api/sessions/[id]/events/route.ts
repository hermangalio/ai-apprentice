import * as store from "@/lib/store";
import { fail, loadSession, readJSONBody, sessionT } from "@/lib/capture/http";
import { redact } from "@/lib/capture/redact";
import { frameForDomEvent, isPurged } from "@/lib/capture/vision";
import type { CaseFacts, ScreenEvent, ScreenEventKind } from "@/lib/types";

const KINDS: ScreenEventKind[] = ["open", "navigate", "field_change", "action", "other"];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id);
  if (session instanceof Response) return session;
  const since = Number(new URL(req.url).searchParams.get("since"));
  const all = await store.events.all(id);
  all.sort((a, b) => a.t - b.t);
  return Response.json(Number.isFinite(since) && since > 0 ? all.filter((e) => e.t > since) : all);
}

// Personal data in string facts (for example an email address or a phone
// number in a contact field) is masked the same way as transcript text.
function redactFacts(facts: CaseFacts): CaseFacts {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facts)) out[k] = typeof v === "string" ? redact(v) : v;
  return out as CaseFacts;
}

// Accepts one DOM event or an array of them from the sandbox. The server
// assigns id and t (from `wallTime` when present), masks personal data in
// summary, before, after and facts, and attaches a frame. A frame stored
// shortly after the event replaces that link (relinkDomEvents in vision.ts).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id, { write: true });
  if (session instanceof Response) return session;
  const body = await readJSONBody(req);
  if (!body || typeof body !== "object") return fail(400, "Expected a JSON event or array of events");

  const frames = await store.frames.all(id);

  const out: ScreenEvent[] = [];
  for (const raw of Array.isArray(body) ? body : [body]) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.summary !== "string" || !r.summary.trim()) continue;
    const kind = KINDS.includes(r.kind as ScreenEventKind) ? (r.kind as ScreenEventKind) : "other";
    // Typing pings are an activity signal only and are never stored.
    if (kind === "other" && r.summary.trim().toLowerCase() === "typing") continue;
    const t =
      typeof r.wallTime === "number" && Number.isFinite(r.wallTime)
        ? sessionT(session, r.wallTime)
        : typeof r.t === "number" && Number.isFinite(r.t) && r.t >= 0
          ? Math.round(r.t)
          : sessionT(session);
    if (isPurged(id, t)) continue;
    const ev: ScreenEvent = { id: store.newId("evt"), t, kind, summary: redact(r.summary.trim()).slice(0, 300), source: "dom" };
    const ent = r.entity as Record<string, unknown> | undefined;
    if (ent && typeof ent.type === "string" && (typeof ent.id === "string" || typeof ent.id === "number")) {
      ev.entity = { type: ent.type, id: String(ent.id) };
    }
    if (typeof r.field === "string") ev.field = r.field;
    if (typeof r.before === "string" || typeof r.before === "number") ev.before = redact(String(r.before));
    if (typeof r.after === "string" || typeof r.after === "number") ev.after = redact(String(r.after));
    if (typeof r.action === "string") ev.action = r.action;
    if (typeof r.committed === "boolean") ev.committed = r.committed;
    if (r.facts && typeof r.facts === "object" && !Array.isArray(r.facts)) ev.facts = redactFacts(r.facts as CaseFacts);
    const frameId = frameForDomEvent(frames, t);
    if (frameId) ev.frameId = frameId;
    out.push(ev);
  }
  if (out.length) await store.events.append(id, ...out);
  return Response.json(out, { status: 201 });
}
