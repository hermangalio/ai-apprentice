import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// Server-only. Runs through the local Claude Code login (subscription), so
// there is no API key. Every model call in the app goes through llmJSON.

export type LLMImage = { base64: string; mediaType: "image/jpeg" | "image/png" };

export type LLMRequest = {
  system: string;
  prompt: string;
  images?: LLMImage[];
  // "haiku" for per-frame vision and live checks, "sonnet" for merge/debrief work.
  model?: "haiku" | "sonnet" | "opus";
};

// On a server there is no Claude Code login. With LLM_BACKEND=api and an
// ANTHROPIC_API_KEY the same calls go straight to the Messages API instead.
const API_MODE = process.env.LLM_BACKEND === "api" && !!process.env.ANTHROPIC_API_KEY;
const API_MODELS = { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;

type ApiBlock = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type ApiMessage = { role: "user" | "assistant"; content: ApiBlock[] | string };

function userBlocks(prompt: string, images: LLMImage[] = []): ApiBlock[] {
  return [
    { type: "text", text: prompt },
    ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
  ];
}

async function apiCall(system: string, messages: ApiMessage[], model: LLMRequest["model"] = "haiku"): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: API_MODELS[model ?? "haiku"], max_tokens: 8000, system, messages }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
}

function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error(`No JSON in model output: ${text.slice(0, 200)}`);
  const open = body[start];
  const end = body.lastIndexOf(open === "{" ? "}" : "]");
  return JSON.parse(body.slice(start, end + 1));
}

export async function llmText(req: LLMRequest): Promise<string> {
  if (API_MODE) return apiCall(req.system, [{ role: "user", content: userBlocks(req.prompt, req.images) }], req.model);
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          { type: "text", text: req.prompt },
          ...(req.images ?? []).map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
          })),
        ],
      },
    } as SDKUserMessage;
  }

  // Subscription auth only: an inherited API key would silently switch billing.
  const env = { ...process.env } as Record<string, string>;
  delete env.ANTHROPIC_API_KEY;

  for await (const message of query({
    prompt: input(),
    options: {
      model: req.model ?? "haiku",
      systemPrompt: req.system,
      maxTurns: 1,
      tools: [],
      settingSources: [],
      persistSession: false,
      env,
    },
  })) {
    if (message.type === "result") {
      if (message.subtype === "success") return message.result;
      throw new Error(`LLM call failed: ${message.subtype}`);
    }
  }
  throw new Error("LLM call ended without a result");
}

export async function llmJSON<T = unknown>(req: LLMRequest): Promise<T> {
  const text = await llmText({
    ...req,
    system: `${req.system}\n\nRespond with a single JSON value and nothing else.`,
  });
  return extractJSON(text) as T;
}

// A long-lived model session. A cold call costs 8-10 s (process spawn plus
// first request); a warm one answers a frame in 2-3 s. Earlier turns stay in
// context, so a vision session can be asked "what changed since the last
// frame" while only the new frame is sent. Calls are serialized, and the
// underlying process is recycled every `maxCalls` turns to bound context.
export class WarmSession {
  private pending: Array<{ msg: SDKUserMessage; resolve: (s: string) => void; reject: (e: Error) => void }> = [];
  private wake: (() => void) | null = null;
  private inFlight: { resolve: (s: string) => void; reject: (e: Error) => void } | null = null;
  private calls = 0;
  private running = false;
  private closed = false;
  // API mode: the conversation so far, and a chain that serializes calls.
  private history: ApiMessage[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  private opts: { system: string; model?: LLMRequest["model"]; maxCalls?: number };

  constructor(opts: { system: string; model?: LLMRequest["model"]; maxCalls?: number }) {
    this.opts = opts;
  }

  // Ends the underlying process once the call in flight (if any) has finished.
  close() {
    this.closed = true;
    this.history = [];
    for (const p of this.pending.splice(0)) p.reject(new Error("WarmSession closed"));
    if (!this.inFlight) this.wake?.();
  }

  ask(prompt: string, images: LLMImage[] = []): Promise<string> {
    if (this.closed) return Promise.reject(new Error("WarmSession closed"));
    if (API_MODE) {
      const run = this.chain.then(async () => {
        const system = `${this.opts.system}\n\nRespond with a single JSON value and nothing else.`;
        const turn: ApiMessage = { role: "user", content: userBlocks(prompt, images) };
        const text = await apiCall(system, [...this.history, turn], this.opts.model);
        // Keep the last few exchanges as context (the previous frames).
        this.history = [...this.history, turn, { role: "assistant" as const, content: text }].slice(-6);
        return text;
      });
      this.chain = run.catch(() => {});
      return run;
    }
    const msg = {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
          })),
        ],
      },
    } as SDKUserMessage;
    return new Promise((resolve, reject) => {
      this.pending.push({ msg, resolve, reject });
      if (!this.running) void this.run();
      else if (!this.inFlight) this.wake?.();
    });
  }

  async askJSON<T = unknown>(prompt: string, images: LLMImage[] = []): Promise<T> {
    return extractJSON(await this.ask(prompt, images)) as T;
  }

  private async run() {
    this.running = true;
    while (this.pending.length > 0) {
      this.calls = 0;
      const maxCalls = this.opts.maxCalls ?? 25;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      async function* input(): AsyncGenerator<SDKUserMessage> {
        while (self.calls < maxCalls && !self.closed) {
          if (self.pending.length === 0) {
            // Idle: keep the process warm until the next ask() arrives.
            await new Promise<void>((r) => (self.wake = r));
            self.wake = null;
          }
          const next = self.pending.shift();
          if (!next) return; // woken by close()
          self.inFlight = next;
          self.calls++;
          yield next.msg;
          await new Promise<void>((r) => (self.wake = r));
          self.wake = null;
        }
      }
      const env = { ...process.env } as Record<string, string>;
      delete env.ANTHROPIC_API_KEY;
      try {
        for await (const message of query({
          prompt: input(),
          options: {
            model: this.opts.model ?? "haiku",
            systemPrompt: `${this.opts.system}\n\nRespond with a single JSON value and nothing else.`,
            tools: [],
            settingSources: [],
            persistSession: false,
            thinking: { type: "disabled" },
            env,
          },
        })) {
          if (message.type === "result") {
            const current = this.inFlight;
            this.inFlight = null;
            if (message.subtype === "success") current?.resolve(message.result);
            else current?.reject(new Error(`LLM call failed: ${message.subtype}`));
            this.wake?.();
          }
        }
      } catch (err) {
        this.inFlight?.reject(err as Error);
        this.inFlight = null;
      }
    }
    this.running = false;
  }
}

// One warm session per key, kept across Next dev hot reloads.
const sessions = ((globalThis as Record<string, unknown>).__warmSessions ??= new Map()) as Map<string, WarmSession>;

export function warmSession(key: string, opts: { system: string; model?: LLMRequest["model"]; maxCalls?: number }) {
  let s = sessions.get(key);
  if (!s) sessions.set(key, (s = new WarmSession(opts)));
  return s;
}
