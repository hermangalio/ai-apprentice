import * as store from "@/lib/store";
import type { Session } from "@/lib/types";

// Small helpers shared by the /api/sessions route handlers.

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const fail = (status: number, error: string) => Response.json({ error }, { status });

// Loads the session or returns the error response to send instead.
export async function loadSession(id: string, opts: { write?: boolean } = {}): Promise<Session | Response> {
  if (!SAFE_ID.test(id)) return fail(400, "Invalid session id");
  const session = await store.sessions.get(id);
  if (!session) return fail(404, "Session not found");
  // Fixtures are shared test data and stay read-only.
  if (opts.write && id.startsWith("fixture_")) return fail(403, "Fixture sessions are read-only");
  return session;
}

export const sessionT = (session: Session, wallTime = Date.now()) =>
  Math.max(0, Math.round(wallTime - Date.parse(session.startedAt)));

export async function readJSONBody(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
