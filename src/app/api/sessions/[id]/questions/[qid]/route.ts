import * as store from "@/lib/store";
import { fail, loadSession, readJSONBody, SAFE_ID, sessionT } from "@/lib/capture/http";
import type { Phase, Question } from "@/lib/types";

const STATUSES: Question["status"][] = ["queued", "asked", "answered", "dropped"];
const PHASES: Phase[] = ["capture", "debrief", "teach"];

// Updates one question. Body: any of {status, askedAt, askedIn,
// answerTranscriptIds}. Setting status "asked" without askedAt stamps the
// current session time and phase "capture".
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await ctx.params;
  const session = await loadSession(id, { write: true });
  if (session instanceof Response) return session;
  if (!SAFE_ID.test(qid)) return fail(400, "Invalid question id");
  const body = (await readJSONBody(req)) as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return fail(400, "Expected a JSON body");

  const current = (await store.questions.all(id)).find((q) => q.id === qid);
  if (!current) return fail(404, "Question not found");
  const next: Question = { ...current };

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Question["status"])) return fail(400, "Invalid status");
    next.status = body.status as Question["status"];
  }
  if (typeof body.askedAt === "number" && Number.isFinite(body.askedAt)) next.askedAt = Math.round(body.askedAt);
  if (PHASES.includes(body.askedIn as Phase)) next.askedIn = body.askedIn as Phase;
  if (Array.isArray(body.answerTranscriptIds)) {
    const ids = body.answerTranscriptIds.filter((x): x is string => typeof x === "string");
    next.answerTranscriptIds = [...new Set([...(current.answerTranscriptIds ?? []), ...ids])];
  }
  if (next.status === "asked" || next.status === "answered") {
    next.askedAt ??= sessionT(session);
    next.askedIn ??= "capture";
  }

  await store.questions.upsert(id, next);
  return Response.json(next);
}
