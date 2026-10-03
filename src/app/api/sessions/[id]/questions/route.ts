import * as store from "@/lib/store";
import { loadSession } from "@/lib/capture/http";

// All questions of the session: asked, answered, queued for the debrief, dropped.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id);
  if (session instanceof Response) return session;
  return Response.json(await store.questions.all(id));
}
