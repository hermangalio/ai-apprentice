import * as store from "@/lib/store";
import { fail, loadSession, readJSONBody } from "@/lib/capture/http";
import { purgeVision } from "@/lib/capture/vision";

// Body {fromT, toT} in ms since session start. Deletes frames, events and
// transcript items in that window and makes the vision model forget them.
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
  const count = async () => ({
    frames: (await store.frames.all(id)).length,
    events: (await store.events.all(id)).length,
    transcript: (await store.transcript.all(id)).length,
  });
  const before = await count();
  // Register the window first so results still in flight are dropped.
  purgeVision(id, from, to);
  await store.purgeWindow(id, from, to);
  const after = await count();
  return Response.json({
    fromT: from,
    toT: to,
    purged: {
      frames: before.frames - after.frames,
      events: before.events - after.events,
      transcript: before.transcript - after.transcript,
    },
  });
}
