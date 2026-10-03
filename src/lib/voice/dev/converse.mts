// Runs a short scripted text-only conversation with one of the agents over the
// raw WebSocket protocol and prints what the agent said and which tools it called.
//
//   node src/lib/voice/dev/converse.mts <interviewer|debrief|tutor> <scenario.json>
//
// scenario.json: { "vars": {...dynamic variables}, "steps": [
//   { "send": "user message" } | { "context": "contextual update" } | { "wait": 3000 } ] }
// Add "voice": true to keep audio on (used to test silence handling; costs minutes).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
const KEY = process.env.ELEVENLABS_API_KEY ?? env.match(/^ELEVENLABS_API_KEY=(.*)$/m)?.[1].trim() ?? "";
const agents = JSON.parse(readFileSync(path.join(ROOT, "src/lib/voice/agents.json"), "utf8")) as Record<string, string>;

const [mode, scenarioFile] = process.argv.slice(2);
if (!agents[mode] || !scenarioFile) {
  console.error("usage: converse.mts <interviewer|debrief|tutor> <scenario.json>");
  process.exit(1);
}

type Step = { send?: string; context?: string; wait?: number; silence?: number };
const scenario = JSON.parse(readFileSync(scenarioFile, "utf8")) as {
  vars?: Record<string, string>;
  steps: Step[];
  voice?: boolean;
};

const signed = await fetch(
  `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agents[mode]}`,
  { headers: { "xi-api-key": KEY } },
).then((r) => r.json() as Promise<{ signed_url?: string }>);
if (!signed.signed_url) {
  console.error("No signed URL:", signed);
  process.exit(1);
}

const ws = new WebSocket(signed.signed_url);
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
let lastEventAt = Date.now();
let agentTurns = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = (msg: unknown) => ws.send(JSON.stringify(msg));

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  switch (msg.type) {
    case "ping":
      send({ type: "pong", event_id: msg.ping_event.event_id });
      return;
    case "audio":
    case "vad_score":
    case "internal_tentative_agent_response":
    case "agent_chat_response_part":
      lastEventAt = Date.now();
      return;
    case "conversation_initiation_metadata":
      console.log(`${stamp()} connected ${msg.conversation_initiation_metadata_event.conversation_id}`);
      break;
    case "agent_response":
      agentTurns++;
      console.log(`${stamp()} AGENT: ${msg.agent_response_event.agent_response.trim()}`);
      break;
    case "agent_response_correction":
      console.log(`${stamp()} AGENT (corrected): ${msg.agent_response_correction_event.corrected_agent_response}`);
      break;
    case "user_transcript":
      console.log(`${stamp()} user_transcript: ${msg.user_transcription_event.user_transcript}`);
      break;
    case "client_tool_call": {
      const c = msg.client_tool_call;
      console.log(`${stamp()} CLIENT TOOL ${c.tool_name}(${JSON.stringify(c.parameters)})`);
      if (c.expects_response) {
        send({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: "ok", is_error: false });
      }
      break;
    }
    case "agent_tool_request":
      console.log(`${stamp()} tool request: ${msg.agent_tool_request?.tool_name}`);
      break;
    case "agent_tool_response":
      console.log(`${stamp()} tool response: ${msg.agent_tool_response?.tool_name} (${msg.agent_tool_response?.tool_type})`);
      break;
    default:
      console.log(`${stamp()} [${msg.type}] ${JSON.stringify(msg).slice(0, 200)}`);
  }
  lastEventAt = Date.now();
});
ws.addEventListener("close", (ev) => console.log(`${stamp()} closed ${ev.code} ${ev.reason}`));
ws.addEventListener("error", () => console.log(`${stamp()} socket error`));

await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
send({
  type: "conversation_initiation_client_data",
  conversation_config_override: scenario.voice ? {} : { conversation: { text_only: true } },
  dynamic_variables: scenario.vars ?? {},
});
await sleep(1500);

// Wait until the agent has been quiet for `quietMs`, at most `maxMs`.
async function settle(quietMs = Number(process.env.QUIET_MS ?? 3500), maxMs = 60000) {
  const start = Date.now();
  lastEventAt = Date.now();
  while (Date.now() - start < maxMs && Date.now() - lastEventAt < quietMs) await sleep(250);
}

for (const step of scenario.steps) {
  if (ws.readyState !== WebSocket.OPEN) break;
  if (step.send !== undefined) {
    console.log(`${stamp()} USER: ${step.send}`);
    send({ type: "user_message", text: step.send });
    await settle();
  } else if (step.context !== undefined) {
    console.log(`${stamp()} context: ${step.context.slice(0, 120)}`);
    send({ type: "contextual_update", text: step.context });
    await sleep(500);
  } else if (step.silence !== undefined) {
    // Stream silent 16 kHz PCM, the way a muted microphone does.
    console.log(`${stamp()} streaming ${step.silence} ms of silence`);
    const chunk = Buffer.alloc(3200).toString("base64"); // 100 ms
    const before = agentTurns;
    const end = Date.now() + step.silence;
    while (Date.now() < end && ws.readyState === WebSocket.OPEN) {
      send({ user_audio_chunk: chunk });
      await sleep(100);
    }
    console.log(`${stamp()} silence done, agent spoke ${agentTurns - before} time(s) during it`);
  } else if (step.wait !== undefined) {
    await sleep(step.wait);
  }
}

ws.close();
await sleep(300);
process.exit(0);
