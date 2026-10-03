import * as store from "@/lib/store";
import { fail, loadSession, readJSONBody, sessionT } from "@/lib/capture/http";
import { redact } from "@/lib/capture/redact";
import { isPurged } from "@/lib/capture/vision";
import type { Phase, Speaker, TranscriptItem } from "@/lib/types";

const SPEAKERS: Speaker[] = ["expert", "learner", "agent"];
const PHASES: Phase[] = ["capture", "debrief", "teach"];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id);
  if (session instanceof Response) return session;
  const since = Number(new URL(req.url).searchParams.get("since"));
  const all = await store.transcript.all(id);
  all.sort((a, b) => a.t - b.t);
  return Response.json(Number.isFinite(since) && since > 0 ? all.filter((x) => x.t > since) : all);
}

// Accepts one item or an array: {speaker, text, phase?, t?}. Text is redacted
// before it is stored. Returns the stored items.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id, { write: true });
  if (session instanceof Response) return session;
  const body = await readJSONBody(req);
  if (!body || typeof body !== "object") return fail(400, "Expected a JSON item or array of items");

  const out: TranscriptItem[] = [];
  for (const raw of Array.isArray(body) ? body : [body]) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== "string" || !r.text.trim()) continue;
    if (!SPEAKERS.includes(r.speaker as Speaker)) return fail(400, 'speaker must be "expert", "learner" or "agent"');
    const t = typeof r.t === "number" && Number.isFinite(r.t) && r.t >= 0 ? Math.round(r.t) : sessionT(session);
    if (isPurged(id, t)) continue;
    out.push({
      id: store.newId("tr"),
      t,
      speaker: r.speaker as Speaker,
      text: redact(r.text.trim()),
      phase: PHASES.includes(r.phase as Phase) ? (r.phase as Phase) : "capture",
    });
  }
  if (out.length) await store.transcript.append(id, ...out);
  return Response.json(out, { status: 201 });
}
