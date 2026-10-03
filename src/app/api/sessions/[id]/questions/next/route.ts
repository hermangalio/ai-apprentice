import * as store from "@/lib/store";
import { loadSession, readJSONBody, sessionT } from "@/lib/capture/http";
import { nextQuestion } from "@/lib/voice/questions";
import type { Question } from "@/lib/types";

// Returns the single best question to ask right now, or null.
//
// Body (all optional):
//   now      session time in ms; defaults to the current session time
//   dryRun   do not write anything; also allowed on fixture sessions
//   untilT   with dryRun: pretend the session only ran until this time. Events
//            and transcript after it are ignored, and questions asked after it
//            count as not yet existing.
//   useLLM   false forces the rule-based fallback
//
// Response: { question, reason, source, queued }. The returned question still
// has status "queued"; PATCH /questions/[qid] marks it asked or answered.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = ((await readJSONBody(req)) ?? {}) as { now?: unknown; dryRun?: unknown; untilT?: unknown; useLLM?: unknown };
  const dryRun = body.dryRun === true;
  const session = await loadSession(id, { write: !dryRun });
  if (session instanceof Response) return session;

  const untilT = dryRun && typeof body.untilT === "number" ? body.untilT : undefined;
  let [events, transcript, questions] = await Promise.all([
    store.events.all(id),
    store.transcript.all(id),
    store.questions.all(id),
  ]);
  events.sort((a, b) => a.t - b.t);
  transcript.sort((a, b) => a.t - b.t);
  if (untilT !== undefined) {
    events = events.filter((e) => e.t <= untilT);
    transcript = transcript.filter((x) => x.t <= untilT);
    questions = questions.filter((q) => q.askedAt !== undefined && q.askedAt <= untilT);
  }
  // The capture phase is what the live interviewer sees.
  transcript = transcript.filter((x) => x.phase === "capture");

  const now = typeof body.now === "number" ? body.now : (untilT ?? sessionT(session));
  const result = await nextQuestion(
    { events, transcript, questions, now },
    { cacheKey: dryRun ? undefined : id, useLLM: body.useLLM !== false },
  );

  if (!dryRun) {
    // Sequential: store writes to one file are serialized anyway.
    for (const q of result.upserts) await store.questions.upsert(id, q);
  }

  const merged = new Map<string, Question>(questions.map((q) => [q.id, q]));
  for (const q of result.upserts) merged.set(q.id, q);
  return Response.json({
    question: result.question,
    reason: result.reason,
    source: result.source,
    queued: [...merged.values()].filter((q) => q.status === "queued").length,
    ...(dryRun ? { candidates: result.upserts } : {}),
  });
}
