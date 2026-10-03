import * as store from "@/lib/store";
import { loadSession } from "@/lib/capture/http";
import { releaseVision } from "@/lib/capture/vision";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id, { write: true });
  if (session instanceof Response) return session;
  const ended = session.endedAt ? session : { ...session, endedAt: new Date().toISOString() };
  if (!session.endedAt) await store.sessions.set(id, ended);
  releaseVision(id);
  return Response.json(ended);
}
