# The AI Apprentice

A voice agent that watches an expert work on screen, asks why at the right moments, turns what it learned into a Work Map, and then coaches a new hire through cases the expert never showed.

Built for the ElevenLabs challenge at the 7th Hack-Nation Global AI Hackathon.

**Live demo:** https://apprentice.galio.tech

## What it does

The app has three parts, and the same ElevenLabs voice plays a different role in each.

### 1. Capture

The expert shares a browser tab and does a real task while thinking aloud. A frame goes to a vision model every second or two and comes back as events ("Track changed from Standard loop to Fast track"). The apprentice stays silent while the expert types, reads or talks. When a decision has just been made and the expert goes quiet, it asks one short spoken question about what is on screen: why this step, is there a limit, when would you stop and ask someone.

### 2. Map

When the task is done, the apprentice runs a spoken debrief. It asks about what is still unclear, then explains the whole process back and asks the expert to confirm or correct it. The result is the Work Map: a clickable sequence of steps, each with the screen moment, the decision, the reason in the expert's own words, and the guardrails around it. A map can also be exported as instructions an agent can load.

### 3. Teach

A new hire works a case on their own screen. The tutor knows the Work Map, asks them to predict the next decision, and steps in before a guardrail is broken. The stop appears in the application they are working in, before the action is confirmed, and the tutor explains it with the expert's own reasoning and a replay of the expert's screen moment. At the end a scorecard shows what was handled without help and what to practice.

## The demo scenario

The sandbox is a hiring desk at Gipfel AI, a fictional ETH Zurich spin-off. Emilie, the head of talent, screens applications for an ML engineer role, and her unwritten rules have little to do with merit: ETH applicants go on the fast track however weak, a UZH PhD with top grades is put on hold, and HEC Lausanne is "the best business school in the world".

The scenario is satire, and it makes a point. The apprentice learns what the expert does, bias included, and the Work Map is the first place those rules are written down where someone can see and question them.

Nothing in the capture, map or teach code is specific to hiring. The rules come from the session, and the sandbox can be swapped for any browser application.

## How it answers the Apprentice Test

| Question | Approach |
|---|---|
| When to ask | A pause detector combines screen activity, typing, live speech from Scribe and whether the agent is speaking. A confirmed action counts as a natural boundary. The agent's microphone is closed outside question windows, so it never replies to thinking aloud. Live questions are capped at five per ten minutes. |
| What to ask | Questions are only generated for decisions: confirmed actions and values changed away from a default. Anything the expert already explained is dropped, and a rule only counts as explained if a limit was actually stated. The rest waits for the debrief. |
| When it has understood | The debrief is done when every open gap is answered or deferred and the expert has confirmed the teach-back. Every quote in the map is checked in code to be verbatim from the transcript. |
| Whether the new hire learned | The new hire works cases the expert never showed. Each guardrail has a machine-checkable form that is evaluated in milliseconds when an action is requested, so the stop comes before the save. The scorecard separates what was handled alone from what the tutor had to catch. |
| Trust | The expert can pause at any time, which stops screen frames, the microphone and logging. Emails, phone numbers, IBANs and card numbers are redacted from transcripts and event text before they are stored or sent to the agent. Screen frames themselves are not redacted, so the demo runs on fake data. |

## How it is built

- **Next.js** app with four areas: `/capture`, `/map/[id]`, `/teach` and the sandbox at `/hiring`.
- **ElevenLabs Agents** for the interviewer, the debrief and the tutor, with client tools that update the Work Map and the tutor panel. **Scribe v2 Realtime** provides the running transcript and the speech signal for pause detection.
- **Claude** for reading screen frames, choosing questions and merging a session into a Work Map.
- **Sandbox events.** The sandbox also reports its own actions to the other tabs, which gives the tutor an instant, exact signal. Vision remains the general path for applications that cannot be instrumented.
- **Storage** is plain JSON files per session under `data/sessions`. On a host with an ephemeral disk, sessions last until the next restart. An example session ships in `fixtures/`.

Main code locations:

| Path | Contents |
|---|---|
| `src/lib/capture` | Screen capture, change detection, vision, redaction |
| `src/lib/voice` | Pause detection, question selection, agent protocol |
| `src/lib/map` | Work Map builder, validation, debrief logic, export |
| `src/lib/teach` | Guardrail checker, tutor instructions, scorecard |
| `src/lib/erp`, `src/app/hiring` | The sandbox hiring desk |
| `scripts/setup-agents.mts` | Creates or updates the three ElevenLabs agents |

## Run it locally

Requires Node 22.

```bash
npm install
```

Create `.env.local`:

```
ELEVENLABS_API_KEY=your-key
LLM_BACKEND=api
ANTHROPIC_API_KEY=your-key
```

Without the last two lines, model calls go through a local Claude Code login using the Claude Agent SDK.

Create the voice agents in your own ElevenLabs account. This writes their ids to `src/lib/voice/agents.json`:

```bash
node --experimental-strip-types scripts/setup-agents.mts
```

Start the app:

```bash
npm run dev
```

Open http://localhost:3000 in Chrome and use headphones, so the agent's voice does not feed back into the microphone. Keep the app pages and the sandbox on the same address, because they talk to each other inside the browser.

## Known limits

- Screen frames are stored and sent to the vision model unredacted.
- Names are sometimes misheard by speech recognition and can end up in rule text.
- A rule only enters the Work Map if the expert shows it, says it, or is asked about it in the debrief.
- The hosted demo has no login and stores sessions on an ephemeral disk.

## Additional Features / Achieved Stretch Goals
- Multilingual support (test on English, Arabic, French, German, and Russian)
- Skill export for future automous agent execution
