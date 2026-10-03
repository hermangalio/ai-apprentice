import agents from "@/lib/voice/agents.json";

// Server-side credentials for a voice session. The API key never leaves the server.
//
//   GET /api/voice/token?agent=interviewer|debrief|tutor
//     -> { agentId, conversationToken, signedUrl }
//        conversationToken: startSession({ conversationToken, connectionType: "webrtc" })
//        signedUrl:         startSession({ signedUrl, connectionType: "websocket" })
//   GET /api/voice/token?agent=scribe
//     -> { token }  single-use token for Scribe v2 Realtime (useScribe().connect({ token }))

export const dynamic = "force-dynamic";

const API = "https://api.elevenlabs.io/v1";
const fail = (status: number, error: string) => Response.json({ error }, { status });

async function call(method: "GET" | "POST", route: string, key: string) {
  const res = await fetch(`${API}${route}`, { method, headers: { "xi-api-key": key }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`ElevenLabs ${route.split("?")[0]} returned ${res.status}`);
  return json;
}

export async function GET(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(500, "ELEVENLABS_API_KEY is not set");
  const agent = new URL(req.url).searchParams.get("agent") ?? "";

  try {
    if (agent === "scribe") {
      const out = await call("POST", "/single-use-token/realtime_scribe", key);
      return Response.json({ token: out.token }, { headers: { "cache-control": "no-store" } });
    }
    const agentId = (agents as Record<string, string>)[agent];
    if (!agentId) return fail(400, "agent must be interviewer, debrief, tutor or scribe");
    const [token, signed] = await Promise.all([
      call("GET", `/convai/conversation/token?agent_id=${agentId}`, key),
      call("GET", `/convai/conversation/get-signed-url?agent_id=${agentId}`, key),
    ]);
    return Response.json(
      { agentId, conversationToken: token.token, signedUrl: signed.signed_url },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "ElevenLabs request failed");
  }
}
