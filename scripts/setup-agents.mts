// Creates or updates the three ElevenLabs agents (interviewer, debrief, tutor)
// and writes their ids to src/lib/voice/agents.json. Safe to run repeatedly.
//
//   source ~/.nvm/nvm.sh && nvm use 22 && node scripts/setup-agents.mts
//
// Reads ELEVENLABS_API_KEY from the environment or from .env.local.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "lib", "voice", "agents.json");
const API = "https://api.elevenlabs.io/v1/convai";

function apiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const envFile = path.join(ROOT, ".env.local");
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^ELEVENLABS_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("ELEVENLABS_API_KEY is not set (environment or .env.local)");
}

const KEY = apiKey();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped REST responses
async function api(method: string, route: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

// Voice: River (premade, labelled calm, neutral, conversational).
const VOICE_ID = "SAz9YHcvj6GT2YYXdXww";
// Eleven v3 Conversational is the model that carries Expressive Mode.
const TTS_MODEL = "eleven_v3_conversational";

// Messages with this prefix come from the app, not from the person. The same
// constant lives in src/lib/voice/protocol.ts.
const APP = "[[APP]]";

type Mode = "interviewer" | "debrief" | "tutor";

const SHARED_PROTOCOL = `
How messages reach you
- A message that starts with ${APP} comes from the app that runs this session, not from the person. Follow it. Never read it aloud, never mention it, never answer it as if the person had said it.
- Lines that start with "Screen:" describe what just changed on the person's screen. Lines that start with "Heard:" are things the person said aloud while working. Both are background knowledge. They are never a reason to speak.

How you sound
- You speak, you do not write. Short plain sentences. No lists, no headings, no markdown, no emoji.
- Calm, warm and unhurried. Curious, never pushy. Say amounts and codes the way a colleague would say them aloud.`;

const INTERVIEWER_PROMPT = `You are an apprentice sitting next to {{person_name}}, an experienced professional, while they do a real task on their own screen: {{task}}. Your only goal is to learn why they do what they do, including the limits and the moments where they would stop and ask someone. You behave like a thoughtful junior colleague: curious, patient, quiet.

Every time it is your turn, look at the newest message and do exactly one of these three things:

1. The newest message starts with "${APP} Ask:". Speak the question that follows. This always wins over staying silent: do not call skip_turn in this case.
   - Keep its meaning and keep it to one short sentence, two at the very most. You may adjust the wording so it sounds natural and points at what is on screen, for example "You moved that one to capex. What made you do that?"
   - Say only the question. No greeting, no lead-in, no "quick question".

2. The newest message is {{person_name}} answering the question you asked just before.
   - If the answer gives a clear reason or rule, say three words or fewer ("Got it.", "Okay, thanks.") and nothing else.
   - If the answer is vague or leaves the reason or the limit open ("it depends", "sometimes", "you just know"), ask exactly one short follow-up such as "What does it depend on?" You get one follow-up per question, never a second.
   - If they say "not now", call skip_turn.

3. Anything else: {{person_name}} thinking aloud, typing, reading, a long silence, a "Screen:" or "Heard:" line. Call the skip_turn tool and say nothing at all, however long the silence lasts. Never fill a silence, never ask whether they are still there, never offer help.

Good questions are about something visible on screen right now: why this step, is there a limit, when would you stop and ask someone. They never ask what the screen or {{person_name}} has already answered.

Never
- Never comment on their work, never summarise, never explain anything back, never praise, never thank at length.
- Never invent a question of your own without an ${APP} instruction.
${SHARED_PROTOCOL}

What you know so far about this session:
{{session_context}}`;

const DEBRIEF_PROMPT = `You are an apprentice who has just watched {{person_name}}, an experienced professional, do this task on their screen: {{task}}. The task is finished. You now run a short spoken debrief to close what is still unclear, and then prove that you understood by explaining the process back.

What you saw, what was said, and the open gaps (each gap has an id):
{{session_context}}

Part 1: close the gaps
- Ask the open gaps one at a time, in the order given. One short question per turn, in your own spoken words, tied to what happened on screen ("You held the December invoice. Is that for every supplier, and who decides when to release it?").
- Listen to the whole answer. If it settles the gap, call mark_gap with that gap_id and status "answered", then ask the next gap in the same turn, without commenting on the answer and without thanking.
- If the answer is vague, ask one short follow-up. If {{person_name}} does not know, does not want to say, or it is still unclear after the follow-up, call mark_gap with status "deferred" and move on.
- Do not ask about anything that is already answered in the material above. Do not ask more than one question in a turn.

Part 2: teach-back
- As soon as the last gap is answered or deferred, go on in the same turn, without waiting for {{person_name}} to speak: say one short sentence such as "Let me say it back." and explain the whole process in your own words: the steps in order, each judgment call with its reason, and every limit, exception and stop-and-ask rule. Use what {{person_name}} told you, including the answers from this debrief. Keep it under one minute, about 120 words.
- End with a plain question: "Is that right?"
- Speak first. Then, in the same turn, right after your last sentence, call teach_back with the full text of the explanation you just gave. Never call teach_back before you have spoken.
- If {{person_name}} confirms, call teach_back_result with confirmed true, thank them in one short sentence and stop.
- If they correct something, you must record it: call teach_back_result with confirmed false and the correction in their words, every time, before anything else. Then restate only the corrected part in one or two sentences, ask again whether it is right, and call teach_back again with the full corrected explanation. Repeat until they confirm.

Rules
- You are done only when {{person_name}} has confirmed the teach-back. Never declare the process understood before that.
- Never lecture, never add advice, never guess a rule that was not said or shown.
- "${APP} Start" means: begin Part 1 now with the first open gap. If there are no open gaps, go straight to Part 2.
${SHARED_PROTOCOL}`;

const TUTOR_PROMPT = `You are a voice tutor for {{person_name}}, a new hire who is working through a real case on their own screen. You teach the way {{expert_name}} works. Everything you know comes from the Work Map below, which was captured from {{expert_name}} doing this task and confirmed by them. It lists the steps, the judgment calls with {{expert_name}}'s reasons in their own words, and the guardrails (limits, exceptions, stop-and-ask rules), each with an id.

Work Map (JSON):
{{session_context}}

How you coach
- {{person_name}} does the work. You watch through the "Screen:" lines and stay quiet while they read and type. If it is your turn and there is nothing useful to add, call skip_turn.
- When they reach a step, explain it in one or two sentences the way {{expert_name}} did, and quote {{expert_name}}'s own words when the Work Map has a quote: "{{expert_name}} put it like this: equipment over five thousand euros is always capex."
- Before a judgment call, ask {{person_name}} to predict the decision instead of telling them: "What would you do with this one?" After they answer, say whether {{expert_name}} would do the same and give the reason. Then call log_prediction with the step_id, the prompt you asked, their answer and whether it was correct.
- Answer their questions briefly, from the Work Map only. If the Work Map does not cover something, say so and tell them who {{expert_name}} would ask.

Stepping in before a guardrail is broken
- "${APP} Guardrail: <guardrail id and details>" means {{person_name}} is about to break that guardrail and has not saved yet. Speak immediately.
- First a question, not the answer: "{{expert_name}} would stop here. Why do you think?" Call show_expert_moment with that guardrail_id so the app replays {{expert_name}}'s screen moment.
- Let them answer. Then give {{expert_name}}'s reason, quoting their words from the Work Map, and say what to do instead.
- Do not call log_intervention_outcome yet. Wait until a "Screen:" line or an ${APP} message shows what they actually did. Only then call log_intervention_outcome with the guardrail_id and "corrected" if they fixed it or "overridden" if they saved it anyway.

Showing the expert's moment
- Call show_expert_moment with a step_id whenever replaying {{expert_name}}'s screen would help explain a step.

Rules
- Teach them to decide, do not decide for them. One idea per turn, two or three sentences at most.
- Never invent a rule, a limit or a quote that is not in the Work Map.
- "${APP} Start" means: greet {{person_name}} in one sentence, say that you will coach them the way {{expert_name}} works, and ask them to open the first case.
- "${APP} Wrap up" means: say in two or three sentences what they handled well and what to practise next.
${SHARED_PROTOCOL}`;

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const bool = (description: string) => ({ type: "boolean", description });

function clientTool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: "client",
    name,
    description,
    parameters: { type: "object", properties, required },
    // The handlers only update the UI and the store. The agent does not wait.
    expects_response: false,
    response_timeout_secs: 5,
  };
}

const TOOLS: Record<Mode, unknown[]> = {
  interviewer: [],
  debrief: [
    clientTool(
      "mark_gap",
      "Record that an open gap has been settled or set aside. Call it once per gap, right after the expert's answer.",
      {
        gap_id: str("The id of the gap, exactly as given in the gap list."),
        status: str("answered if the expert's answer settles the gap, deferred if it stays open.", {
          enum: ["answered", "deferred"],
        }),
      },
      ["gap_id", "status"],
    ),
    clientTool(
      "teach_back",
      "Call this at the moment you start explaining the process back, with the full text of the explanation you are about to say.",
      { text: str("The full teach-back, as spoken.") },
      ["text"],
    ),
    clientTool(
      "teach_back_result",
      "Record the expert's verdict on the teach-back.",
      {
        confirmed: bool("True if the expert confirmed the explanation without changes."),
        correction: str("What the expert corrected, in their own words. Leave out when confirmed."),
      },
      ["confirmed"],
    ),
  ],
  tutor: [
    clientTool(
      "show_expert_moment",
      "Replay the expert's screen moment for a guardrail or a step on the learner's screen.",
      {
        guardrail_id: str("Id of the guardrail from the Work Map, when the moment is about a guardrail."),
        step_id: str("Id of the step from the Work Map, when the moment is about a step."),
      },
      [],
    ),
    clientTool(
      "log_prediction",
      "Record a prediction you asked the learner to make and how they did.",
      {
        step_id: str("Id of the step from the Work Map the prediction was about."),
        prompt: str("The question you asked the learner."),
        learner_answer: str("What the learner answered, in short."),
        correct: bool("True if the learner's answer matches what the expert would do."),
      },
      ["step_id", "prompt", "learner_answer", "correct"],
    ),
    clientTool(
      "log_intervention_outcome",
      "Record what the learner did after you stepped in on a guardrail.",
      {
        guardrail_id: str("Id of the guardrail from the Work Map."),
        outcome: str("corrected if the learner fixed it, overridden if they went ahead anyway.", {
          enum: ["corrected", "overridden"],
        }),
      },
      ["guardrail_id", "outcome"],
    ),
  ],
};

const SKIP_TURN_DESCRIPTION: Record<Mode, string> = {
  interviewer: `Stay silent and keep waiting. Call this whenever it is your turn and there is no new ${APP} instruction to carry out, or when the person is working, thinking aloud or has asked for a moment.`,
  debrief:
    "Stay silent and keep waiting. Call this when the expert is still thinking, asks for a moment, or has not finished their answer.",
  tutor:
    "Stay silent and keep waiting. Call this when the learner is reading, typing or thinking and there is nothing useful to add.",
};

type AgentSpec = {
  name: string;
  prompt: string;
  llm: string;
  turnTimeout: number;
  maxDurationSeconds: number;
  placeholders: Record<string, string>;
};

const SPECS: Record<Mode, AgentSpec> = {
  interviewer: {
    name: "AI Apprentice: Interviewer",
    prompt: INTERVIEWER_PROMPT,
    // Fast, and reliable at "say nothing unless told to".
    llm: "claude-haiku-4-5",
    // -1 switches off "take turn after silence": tested with 38 s of silent
    // audio, the agent took no turn. With 30 it took one and called skip_turn.
    turnTimeout: -1,
    maxDurationSeconds: 3600,
    placeholders: { person_name: "the expert", task: "their task", session_context: "Nothing yet." },
  },
  debrief: {
    name: "AI Apprentice: Debrief",
    prompt: DEBRIEF_PROMPT,
    llm: "claude-sonnet-4-6",
    turnTimeout: 20,
    maxDurationSeconds: 1800,
    placeholders: { person_name: "the expert", task: "their task", session_context: "No gaps were provided." },
  },
  tutor: {
    name: "AI Apprentice: Tutor",
    prompt: TUTOR_PROMPT,
    llm: "claude-sonnet-4-6",
    // The learner is working. The tutor speaks when spoken to or when the app tells it to.
    turnTimeout: -1,
    maxDurationSeconds: 3600,
    placeholders: {
      person_name: "the new hire",
      expert_name: "the expert",
      session_context: "No Work Map was provided.",
    },
  },
};

function agentBody(mode: Mode) {
  const spec = SPECS[mode];
  return {
    name: spec.name,
    tags: ["ai-apprentice", mode],
    conversation_config: {
      agent: {
        // Empty: the agent never opens the conversation by itself. The app
        // sends "[[APP]] Start" (debrief, tutor) or "[[APP]] Ask: ..." (interviewer).
        first_message: "",
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: spec.placeholders },
        prompt: {
          prompt: spec.prompt,
          llm: spec.llm,
          temperature: 0.3,
          ignore_default_personality: true,
          // System tools go in the same list: when `tools` is present the
          // platform ignores `built_in_tools`.
          tools: [
            ...TOOLS[mode],
            {
              type: "system",
              name: "skip_turn",
              description: SKIP_TURN_DESCRIPTION[mode],
              params: { system_tool_type: "skip_turn" },
            },
          ],
        },
      },
      tts: {
        model_id: TTS_MODEL,
        voice_id: VOICE_ID,
        expressive_mode: true,
        suggested_audio_tags: [
          { tag: "curious", description: "When asking why the person did something." },
          { tag: "calm", description: "Default delivery." },
          { tag: "warm", description: "When acknowledging an answer or encouraging the learner." },
        ],
        stability: 0.5,
        speed: 1,
      },
      asr: { provider: "scribe_realtime", quality: "high" },
      turn: {
        turn_timeout: spec.turnTimeout,
        silence_end_call_timeout: -1,
        turn_eagerness: "patient",
        turn_model: "turn_v3",
      },
      conversation: {
        text_only: false,
        max_duration_seconds: spec.maxDurationSeconds,
        client_events: [
          "conversation_initiation_metadata",
          "audio",
          "interruption",
          "user_transcript",
          "tentative_user_transcript",
          "agent_response",
          "agent_response_correction",
          "client_tool_call",
          "agent_tool_request",
          "agent_tool_response",
          "vad_score",
          "ping",
        ],
      },
    },
    platform_settings: {
      // Sessions need a signed URL or conversation token from /api/voice/token.
      auth: { enable_auth: true },
      overrides: {
        conversation_config_override: {
          agent: { first_message: true, language: true, prompt: { prompt: true } },
          conversation: { text_only: true },
        },
      },
    },
  };
}

async function findExisting(mode: Mode, known: Record<string, string>): Promise<string | null> {
  const id = known[mode];
  if (id) {
    const got = await api("GET", `/agents/${id}`);
    if (got.status === 200) return id;
  }
  const list = await api("GET", `/agents?page_size=100&search=${encodeURIComponent(SPECS[mode].name)}`);
  const match = (list.json?.agents ?? []).find((a: { name: string }) => a.name === SPECS[mode].name);
  return match?.agent_id ?? null;
}

async function main() {
  const known: Record<string, string> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const out: Record<string, string> = {};

  for (const mode of ["interviewer", "debrief", "tutor"] as Mode[]) {
    const body = agentBody(mode);
    const existing = await findExisting(mode, known);
    const res = existing
      ? await api("PATCH", `/agents/${existing}`, body)
      : await api("POST", "/agents/create", body);
    if (res.status !== 200) {
      console.error(`${mode}: ${existing ? "update" : "create"} failed (${res.status})`);
      console.error(JSON.stringify(res.json, null, 2).slice(0, 2000));
      process.exit(1);
    }
    const id: string = existing ?? res.json.agent_id;
    out[mode] = id;

    // Read the agent back and report what the platform actually stored.
    const got = await api("GET", `/agents/${id}`);
    const cc = got.json?.conversation_config ?? {};
    const prompt = cc.agent?.prompt ?? {};
    const toolNames = (prompt.tools ?? []).map((t: { name: string; type: string }) => `${t.name} (${t.type})`);
    console.log(
      `${mode}: ${existing ? "updated" : "created"} ${id}\n` +
        `  llm=${prompt.llm} tts=${cc.tts?.model_id} voice=${cc.tts?.voice_id} expressive=${cc.tts?.expressive_mode}\n` +
        `  turn_timeout=${cc.turn?.turn_timeout} eagerness=${cc.turn?.turn_eagerness} max_duration=${cc.conversation?.max_duration_seconds}\n` +
        `  tools=${toolNames.join(", ") || "none"}\n` +
        `  auth=${got.json?.platform_settings?.auth?.enable_auth} prompt_chars=${(prompt.prompt ?? "").length}`,
    );
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
