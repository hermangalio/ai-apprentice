import * as store from "@/lib/store";
import { fail, loadSession, readJSONBody } from "@/lib/capture/http";
import { purgeVision } from "@/lib/capture/vision";
import { forgetQuestionAnalysis } from "@/lib/voice/questions";

// Body {fromT, toT} in ms since session start. Deletes frames, events,
// transcript items and the questions derived from them in that window, and
// makes the vision model and the question analysis forget them.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id, { write: true });
  if (session instanceof Response) return session;
  const body = (await readJSONBody(req)) as { fromT?: unknown; toT?: unknown } | undefined;
  const fromT = Number(body?.fromT);
  const toT = Number(body?.toT);
  if (!Number.isFinite(fromT) || !Number.isFinite(toT) || toT < fromT) {
    return fail(400, "Expected {fromT, toT} with toT >= fromT");
  }
  const from = Math.max(0, Math.floor(fromT));
  const to = Math.ceil(toT);
  // Register the window first so results still in flight are dropped.
  purgeVision(id, from, to);
  forgetQuestionAnalysis(id);
  const purged = await store.purgeWindow(id, from, to);
  return Response.json({ fromT: from, toT: to, purged });
}
