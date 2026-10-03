import * as store from "@/lib/store";
import { fail, loadSession, sessionT } from "@/lib/capture/http";
import { processFrame } from "@/lib/capture/vision";

const MAX_BYTES = 4 * 1024 * 1024;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id);
  if (session instanceof Response) return session;
  return Response.json(await store.frames.all(id));
}

// Body: either raw image/jpeg with `t` in the query string (or an x-frame-t
// header), or multipart form data with a `frame` file and a `t` field.
// Responds with the ScreenEvent[] read from this frame.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await loadSession(id, { write: true });
  if (session instanceof Response) return session;

  let jpeg: Buffer;
  let tRaw: string | null = new URL(req.url).searchParams.get("t") ?? req.headers.get("x-frame-t");
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("frame");
    if (!form || !(file instanceof Blob)) return fail(400, "Expected a `frame` file field");
    jpeg = Buffer.from(await file.arrayBuffer());
    const formT = form.get("t");
    if (typeof formT === "string") tRaw = formT;
  } else {
    jpeg = Buffer.from(await req.arrayBuffer());
  }
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return fail(400, "Body is not a JPEG");
  if (jpeg.length > MAX_BYTES) return fail(413, "Frame too large");

  const tNum = tRaw === null || tRaw === "" ? NaN : Number(tRaw);
  const t = Number.isFinite(tNum) && tNum >= 0 ? Math.round(tNum) : sessionT(session);

  const result = await processFrame(id, jpeg, t);
  return Response.json(result.events, {
    headers: {
      "x-vision-ms": String(result.modelMs),
      ...(result.frame ? { "x-frame-id": result.frame.id } : {}),
      ...(result.skipped ? { "x-capture-skipped": result.skipped } : {}),
    },
  });
}
