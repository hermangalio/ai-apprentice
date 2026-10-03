import { loadSession } from "@/lib/capture/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id);
  return session instanceof Response ? session : Response.json(session);
}
