import * as store from "@/lib/store";
import { fail, loadSession, SAFE_ID } from "@/lib/capture/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; frameId: string }> }) {
  const { id, frameId } = await ctx.params;
  const session = await loadSession(id);
  if (session instanceof Response) return session;
  if (!SAFE_ID.test(frameId)) return fail(400, "Invalid frame id");
  try {
    const jpeg = await store.readFrameImage(id, frameId);
    return new Response(new Uint8Array(jpeg), {
      headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
    });
  } catch {
    return fail(404, "Frame not found");
  }
}
