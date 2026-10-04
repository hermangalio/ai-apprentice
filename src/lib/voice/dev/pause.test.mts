// Replays a recorded session through the pause detector and prints when
// question windows open. Also runs a few assertions on the rules.
//
//   node src/lib/voice/dev/pause.test.mts [sessionDir] [--commit-stamped]
//
// --commit-stamped: the transcript items carry the time Scribe committed them
// (sessions recorded before utterances were stamped with their start). The
// speech is then placed before that time: it ended one second earlier (the
// silence threshold of that build) and lasted about 380 ms per word.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Pause = typeof import("../pause");
const P = (await import(new URL("../pause.ts", import.meta.url).href)) as Pause;
type Dedupe = typeof import("../../capture/dedupe");
const D = (await import(new URL("../../capture/dedupe.ts", import.meta.url).href)) as Dedupe;

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const commitStamped = args.includes("--commit-stamped");
const dir = args.find((a) => !a.startsWith("--")) ?? path.resolve(here, "../../../../fixtures/sessions/fixture_sabine");
const read = (name: string) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
type Ev = import("../../types").ScreenEvent;
const recorded: Ev[] = read("events.json");
recorded.sort((a, b) => a.t - b.t);
// Repeats (a vision event that describes a DOM event again) are left out,
// the way they are when events are stored now.
const canon = D.canonicalEventIds(recorded);
const events = recorded.filter((e) => canon.get(e.id) === e.id);
let frames: { t: number }[] = [];
try {
  frames = read("frames.json");
} catch {}
// Screen activity: an event, or a frame that differed from the one before.
const activity = [...events.map((e) => e.t), ...frames.map((f) => f.t)].sort((a, b) => a - b);
const lastActivity = (now: number) => activity.filter((t) => t <= now).at(-1);
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
  assert.deepEqual(P.evaluatePause({ ...base, questionTimes: [90_000] }).blockedBy, ["min_gap"]);
  assert.equal(P.evaluatePause({ ...base, questionTimes: [90_000] }).opensAt, 90_000 + P.MIN_QUESTION_GAP_MS);
  // After three questions in the window the gap is the longer one.
  assert.deepEqual(P.evaluatePause({ ...base, questionTimes: [10_000, 35_000, 60_000] }).blockedBy, ["min_gap"]);
  assert.equal(P.evaluatePause({ ...base, questionTimes: [10_000, 35_000, 60_000] }).opensAt, 60_000 + P.LATER_QUESTION_GAP_MS);
  // Commit boundary: the screen may still be changing, speech must be quiet.
  const commit = { ...base, lastCommitAt: 98_000, lastScreenActivityAt: 99_500 };
  assert.equal(P.evaluatePause(commit).open, true, "after a commit the screen does not have to be still");
  assert.deepEqual(P.evaluatePause({ ...commit, lastUserSpeechAt: 99_500 }).blockedBy, ["talking"], "never mid-sentence");
  assert.equal(P.evaluatePause({ ...commit, lastUserSpeechAt: 100_000 - P.COMMIT_SPEECH_QUIET_MS }).open, true);
  assert.deepEqual(P.evaluatePause({ ...commit, lastTypingAt: 99_000 }).blockedBy, ["typing"]);
  assert.deepEqual(P.evaluatePause({ ...commit, lastCommitAt: 99_800 }).blockedBy, ["reading"], "not in the first moment after the commit");
  assert.deepEqual(
    P.evaluatePause({ ...commit, lastCommitAt: 100_000 - P.COMMIT_WINDOW_MS - 1 }).blockedBy,
    ["reading"],
    "the boundary ends, the normal rule applies again",
  );
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
const MS_PER_WORD = 380;
const OLD_COMMIT_SILENCE_MS = 1000;
let prevEnd = 0;
const speech = transcript
  .filter((x) => x.phase === "capture")
  .sort((a, b) => a.t - b.t)
  .map((x) => {
    const dur = x.text.split(/\s+/).length * MS_PER_WORD;
    if (!commitStamped) return { ...x, end: x.t + dur };
    const end = x.t - OLD_COMMIT_SILENCE_MS;
    // The previous item was committed after its own second of silence.
    const start = Math.max(end - dur, prevEnd + OLD_COMMIT_SILENCE_MS);
    prevEnd = end;
    return { ...x, t: Math.min(start, end), end };
  });
if (commitStamped) {
  console.log("\nspeech reconstructed from commit-stamped items:");
  for (const s of speech) console.log(`  ${(s.t / 1000).toFixed(1)} to ${(s.end / 1000).toFixed(1)} s  ${s.text.slice(0, 60)}`);
}
const commits = events.filter((e) => e.kind === "action" && e.committed === true);
const lastCommit = (now: number) => commits.filter((e) => e.t <= now).at(-1)?.t ?? null;
// The same value the live hook uses: speech counts until `now` while an utterance is in progress.
const speechAt = (list: { t: number; end: number }[], now: number) => {
  const last = list.filter((s) => s.t <= now).at(-1);
  return last ? Math.min(now, last.end) : null;
};
const endT = Math.max(...events.map((e) => e.t)) + 30_000;

// Events an apprentice would want to ask about (the replay does not call the
// question selector; it only needs to know whether something is pending).
const judgment = events.filter(
  (e) => e.kind === "field_change" || (e.kind === "action" && e.committed !== false && !/requested/i.test(e.summary)),
);

console.log(`\nreplay of ${path.basename(dir)}: ${recorded.length} recorded events, ${events.length} without repeats, ${frames.length} frames, ${speech.length} capture utterances`);
console.log(
  `thresholds: screen ${P.SCREEN_QUIET_MS} ms, typing ${P.TYPING_QUIET_MS} ms, speech ${P.SPEECH_QUIET_MS} ms, ` +
    `after a commit: speech ${P.COMMIT_SPEECH_QUIET_MS} ms for ${P.COMMIT_WINDOW_MS / 1000} s, warm-up ${P.WARMUP_MS / 1000} s, ` +
    `gap ${P.MIN_QUESTION_GAP_MS / 1000} s, max ${P.MAX_QUESTIONS_PER_WINDOW} per ${P.QUESTION_WINDOW_MS / 60000} min\n`,
);

// Pass A: windows from the recorded activity alone, no questions asked.
console.log("A. pause windows from the recorded timeline (expert activity only):");
{
  let wasOpen = false;
  let openedAt = 0;
  for (let now = 0; now <= endT; now += 250) {
    const d = P.evaluatePause({
      now,
      lastScreenActivityAt: lastActivity(now),
      lastCommitAt: lastCommit(now),
      lastUserSpeechAt: speechAt(speech.filter((s) => s.speaker === "expert"), now),
      agentSpeaking: false,
    });
    if (d.open && !wasOpen) openedAt = now;
    const s1 = (ms: number) => (ms / 1000).toFixed(1);
    if (!d.open && wasOpen) {
      const c = lastCommit(openedAt);
      const boundary = P.atCommitBoundary(openedAt, c) ? ` (commit boundary, ${s1(openedAt - c!)} s after the commit at ${s1(c!)} s)` : "";
      console.log(`  open ${s1(openedAt)} to ${s1(now)} s${boundary}  closed by: ${d.blockedBy.join(", ")}`);
    }
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
    const awaiting = now < awaitUntil;
    const d = P.evaluatePause({
      now,
      lastScreenActivityAt: lastActivity(now),
      lastCommitAt: lastCommit(now),
      lastUserSpeechAt: speechAt(simSpeech, now),
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
    console.log(`  ${(now / 1000).toFixed(1)} s ask about ${target.id} (${(target.t / 1000).toFixed(1)} s ${target.summary})${P.atCommitBoundary(now, lastCommit(now)) ? "  [commit boundary]" : ""}`);
  }
  const minutes = endT / 60000;
  console.log(`  ${askedTimes.length} questions in ${minutes.toFixed(1)} min (${((askedTimes.length / minutes) * 10).toFixed(1)} per 10 min)`);
  for (let i = 1; i < askedTimes.length; i++) assert.ok(askedTimes[i] - askedTimes[i - 1] >= P.MIN_QUESTION_GAP_MS);
  assert.ok(askedTimes.length <= P.MAX_QUESTIONS_PER_WINDOW);
  // The fixture is a full session and has to reach the bar of three questions.
  if (!commitStamped) assert.ok(askedTimes.length >= 3);
}
