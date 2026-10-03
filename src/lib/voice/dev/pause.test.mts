// Replays a recorded session through the pause detector and prints when
// question windows open. Also runs a few assertions on the rules.
//
//   node src/lib/voice/dev/pause.test.mts [sessionDir]

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Pause = typeof import("../pause");
const P = (await import(new URL("../pause.ts", import.meta.url).href)) as Pause;

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? path.resolve(here, "../../../../fixtures/sessions/fixture_sabine");
const read = (name: string) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
const events: { id: string; t: number; summary: string; kind: string }[] = read("events.json");
const transcript: { t: number; speaker: string; text: string; phase: string }[] = read("transcript.json");

const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// 1. Unit checks.
{
  const base = { now: 100_000, agentSpeaking: false };
  assert.equal(P.evaluatePause(base).open, true, "nothing happening: open");
  assert.deepEqual(P.evaluatePause({ ...base, lastTypingAt: 99_000 }).blockedBy, ["typing"]);
  assert.deepEqual(P.evaluatePause({ ...base, lastScreenActivityAt: 98_000 }).blockedBy, ["reading"]);
  assert.deepEqual(P.evaluatePause({ ...base, lastUserSpeechAt: 99_500 }).blockedBy, ["talking"]);
  assert.deepEqual(P.evaluatePause({ ...base, agentSpeaking: true }).blockedBy, ["agent_speaking"]);
  assert.deepEqual(P.evaluatePause({ ...base, questionTimes: [80_000] }).blockedBy, ["min_gap"]);
  assert.equal(P.evaluatePause({ ...base, questionTimes: [80_000] }).opensAt, 80_000 + P.MIN_QUESTION_GAP_MS);
  assert.deepEqual(P.evaluatePause({ now: 5_000, agentSpeaking: false }).blockedBy, ["warmup"]);
  const five = [0, 1, 2, 3, 4].map((i) => 100_000 + i * 60_000);
  const budget = P.evaluatePause({ now: 400_000, agentSpeaking: false, questionTimes: five });
  assert.deepEqual(budget.blockedBy, ["budget"]);
  assert.equal(budget.opensAt, 100_000 + P.QUESTION_WINDOW_MS);
  assert.equal(P.evaluatePause({ now: 100_000 + P.QUESTION_WINDOW_MS, agentSpeaking: false, questionTimes: five }).open, true);

  const ask = { askedAt: 10_000, agentSpeaking: false, lastAgentSpeechAt: 12_000 };
  assert.equal(P.evaluateAnswer({ ...ask, now: 15_000 }), "waiting");
  assert.equal(P.evaluateAnswer({ ...ask, now: 15_000, lastUserSpeechAt: 14_500 }), "answering");
  assert.equal(P.evaluateAnswer({ ...ask, now: 18_000, lastUserSpeechAt: 14_500 }), "answered");
  assert.equal(P.evaluateAnswer({ ...ask, now: 12_000 + P.ANSWER_TIMEOUT_MS + 1 }), "unanswered");
  assert.equal(P.evaluateAnswer({ ...ask, now: 18_000, lastUserSpeechAt: 14_500, agentSpeaking: true }), "waiting");
  console.log("unit checks passed");
}

// 2. Replay. Speech is reconstructed from the transcript: an utterance starts
// at its `t` and lasts about 380 ms per word.
const speech = transcript
  .filter((x) => x.phase === "capture")
  .map((x) => ({ ...x, end: x.t + x.text.split(/\s+/).length * 380 }));
const endT = Math.max(...events.map((e) => e.t)) + 30_000;

// Events an apprentice would want to ask about (the replay does not call the
// question selector; it only needs to know whether something is pending).
const judgment = events.filter((e) => e.kind === "field_change" || (e.kind === "action" && !/posted/i.test(e.summary)));

console.log(`\nreplay of ${path.basename(dir)}: ${events.length} events, ${speech.length} capture utterances`);
console.log(
  `thresholds: screen ${P.SCREEN_QUIET_MS} ms, typing ${P.TYPING_QUIET_MS} ms, speech ${P.SPEECH_QUIET_MS} ms, ` +
    `gap ${P.MIN_QUESTION_GAP_MS / 1000} s, max ${P.MAX_QUESTIONS_PER_WINDOW} per ${P.QUESTION_WINDOW_MS / 60000} min\n`,
);

// Pass A: windows from the recorded activity alone, no questions asked.
console.log("A. pause windows from the recorded timeline (expert activity only):");
{
  let wasOpen = false;
  let openedAt = 0;
  for (let now = 0; now <= endT; now += 250) {
    const lastEvent = events.filter((e) => e.t <= now).at(-1);
    const expert = speech.filter((s) => s.speaker === "expert" && s.t <= now).at(-1);
    const d = P.evaluatePause({
      now,
      lastScreenActivityAt: lastEvent?.t,
      lastUserSpeechAt: expert ? Math.min(now, expert.end) : null,
      agentSpeaking: false,
    });
    if (d.open && !wasOpen) openedAt = now;
    if (!d.open && wasOpen) console.log(`  open ${fmt(openedAt)} to ${fmt(now)}  closed by: ${d.blockedBy.join(", ")}`);
    wasOpen = d.open;
  }
  if (wasOpen) console.log(`  open ${fmt(openedAt)} to ${fmt(endT)}  (end of replay)`);
}

// Pass B: simulate asking. When a window opens and a judgment event younger
// than MAX_EVENT_AGE_MS has not been asked about, a question is asked. The
// recorded answer to the nearest recorded question is replayed after it.
console.log("\nB. simulated live questions (recorded: " +
  transcript.filter((x) => x.phase === "capture" && x.speaker === "agent").map((x) => fmt(x.t)).join(", ") + "):");
{
  const askedTimes: number[] = [];
  const askedEvents = new Set<string>();
  const simSpeech: { t: number; end: number; speaker: string }[] = speech
    .filter((s) => s.speaker === "expert")
    // Recorded answers are re-timed below; keep only think-aloud here.
    .filter((s) => !transcript.some((q) => q.speaker === "agent" && q.phase === "capture" && s.t - q.t > 0 && s.t - q.t < 15_000));
  const answers = speech.filter((s) => s.speaker === "expert" && !simSpeech.includes(s));
  let agentUntil = -1;
  // End of the current question window: the replayed answer plus the quiet time.
  let awaitUntil = -1;
  for (let now = 0; now <= endT; now += 250) {
    const lastEvent = events.filter((e) => e.t <= now).at(-1);
    const expert = simSpeech.filter((s) => s.t <= now).at(-1);
    const awaiting = now < awaitUntil;
    const d = P.evaluatePause({
      now,
      lastScreenActivityAt: lastEvent?.t,
      lastUserSpeechAt: expert ? Math.min(now, expert.end) : null,
      agentSpeaking: now < agentUntil,
      lastAgentSpeechAt: agentUntil > 0 ? Math.min(now, agentUntil) : null,
      awaitingAnswer: awaiting,
      questionTimes: askedTimes,
    });
    if (!d.open) continue;
    const target = judgment.filter((e) => e.t <= now && now - e.t <= P.MAX_EVENT_AGE_MS && !askedEvents.has(e.id)).at(-1);
    if (!target) continue;
    askedTimes.push(now);
    askedEvents.add(target.id);
    agentUntil = now + 3000;
    const answer = answers.shift();
    if (answer) simSpeech.push({ t: now + 5000, end: now + 5000 + (answer.end - answer.t), speaker: "expert" });
    awaitUntil = answer ? now + 5000 + (answer.end - answer.t) + P.ANSWER_QUIET_MS : now + 3000 + P.ANSWER_TIMEOUT_MS;
    simSpeech.sort((a, b) => a.t - b.t);
    console.log(`  ${fmt(now)} ask about ${target.id} (${fmt(target.t)} ${target.summary})`);
  }
  const minutes = endT / 60000;
  console.log(`  ${askedTimes.length} questions in ${minutes.toFixed(1)} min (${((askedTimes.length / minutes) * 10).toFixed(1)} per 10 min)`);
  for (let i = 1; i < askedTimes.length; i++) assert.ok(askedTimes[i] - askedTimes[i - 1] >= P.MIN_QUESTION_GAP_MS);
  assert.ok(askedTimes.length >= 3 && askedTimes.length <= P.MAX_QUESTIONS_PER_WINDOW);
}
