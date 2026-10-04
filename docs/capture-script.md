# Capture test script (expert)

Use this to test the live apprentice during Part 1 (Capture). You play Emilie, head of talent at Gipfel AI, an ETH Zurich spin-off. You screen four applications for the ML engineer role while the apprentice watches. Emilie's rules have nothing to do with merit: play them deadpan. Parts 2 and 3 (debrief and new hire) follow at the end.

## Setup

- Chrome, headphones on, one person speaking.
- Open `http://localhost:3000/hiring?set=expert` and click **Reset data** so C-101, C-102, C-103 and C-104 are open.
- Open `http://localhost:3000` in a second tab.

## Play-by-play

A **Stop** means: hands off the mouse and keyboard, say nothing, count to four. That is where the apprentice can ask. There is a Stop after each decision.

| # | Do | Say |
|---|---|---|
| 1 | Click **Capture**. Name: Emilie. Task: "Screen applications for the ML engineer role". Click **Start session** | |
| 2 | Click **Share screen and start** and pick the hiring desk tab. This one button starts the recording, the microphone and the apprentice's voice. Allow the microphone if asked | |
| 3 | Wait until the panel shows the apprentice as connected, then switch to the hiring desk tab | "Okay, four applications for the ML engineer role." |
| 4 | Open C-101 (Nina Baumann, BSc ETH Zurich, final grade 4.0, no work experience) | "Okay, first one. Nina. I always look at the university before anything else." |
| 5 | Open **Education** | "Bachelor's from ETH. Final grade 4.0, passed on the second attempt." |
| 6 | Change **Track** from Standard loop to Fast track | "She goes on the fast track." |
| 7 | **Stop** | |
| 8 | Set **Interviewer** to Reto | "Interviewer goes in before I advance her." |
| 9 | **Stop** | |
| 10 | Click **Advance to interview**, then **Confirm advance** | "Advanced." |
| 11 | **Back to queue**, open C-102 (Jonas Meier, PhD UZH, final grade 6.0, six years of production ML), open **Education** | "Jonas. PhD in machine learning, summa cum laude, six years in production. University of Zurich." |
| 12 | Click **Hold**, then **Confirm hold** | "This one waits." |
| 13 | **Stop** | |
| 14 | **Back to queue**, open C-103 (Priya Nair, PhD EPFL, referred by Luca) | "Priya, PhD from EPFL." |
| 15 | Click **Send to the founders**, then **Confirm sending** | "And this one was referred by Luca, so it goes to the founders." |
| 16 | **Stop** | |
| 17 | **Back to queue**, open C-104 (Maxime Dubois, BSc HEC Lausanne, final grade 4.0, no work experience) | "Maxime. Bachelor's from HEC Lausanne." |
| 18 | Change **Track** to Fast track, set **Interviewer** to Reto | "Fast track, Reto again." |
| 19 | Click **Advance to interview**, then **Confirm advance** | "Advanced." |
| 20 | **Stop** | |
| 21 | Go back to the capture tab and click **Task done, start the debrief** | |

## How to respond when the apprentice asks

Answer with the matching line, then stay quiet for two seconds before you carry on.

| If it asks about | Say |
|---|---|
| Why Nina goes on the fast track, or why you changed the track | "She's from ETH. ETH goes straight to the founder interview. It doesn't matter what the grades say." |
| The interviewer, or advancing without one | "Never. No interviewer, no fast track. If nobody is free I ask Reto who takes it first." |
| Why you put Jonas on hold | "He's from UZH. UZH applications wait." |
| Why Priya goes to the founders | "This one was referred by Luca, so it goes to the founders." |
| Why Maxime goes on the fast track as well | "HEC Lausanne. Best business school in the world. That is always the fast track." |
| Anything else | Answer in one or two sentences, in your own words. |

Keep the hold answer that short. It leaves the scope and the decision-maker open on purpose, so the debrief has something to ask.

If it asks nothing at a Stop, carry on. Questions it did not ask should come up in the debrief.

## Part 2: debrief answers

The Work Map page opens with a list of open gaps. Start the debrief and answer what it asks.

| If it asks about | Say |
|---|---|
| Whether the hold is for every university, how long it lasts, or who decides (it may point out that Jonas had the strongest CV of the four) | "Only UZH. Reto, our CTO, looks at those himself once he has had his coffee. He decides, not me." |
| Why referrals go to the founders, or whether that is every referral | "Anyone referred by an employee needs a second look from the founders, however good the CV is. It's a conflict of interest rule." |
| An applicant who works for an investor or a customer, or a case it has not seen | "I stop and ask the CEO. I never advance someone from an investor or a customer myself." |
| The fast track rule again | Repeat the ETH line or the HEC Lausanne line. |

If it never asks about investors or customers, add the CEO line yourself before the teach-back. C-112 in the learner set depends on it.

When it explains the process back, listen for mistakes. If something is wrong, correct it in one sentence ("Almost. The founders step isn't about salary, it's only for referrals. The rest is right."). If it is right, say "Yes, that's right."

## Part 3: new hire

You now play Lena, the new hire. Open `http://localhost:3000/teach`, start a session with the confirmed Work Map, and open the hiring desk with `?set=learner`.

| # | Do | What should happen |
|---|---|---|
| 1 | Open C-110, Marco Rossi (MSc ETH Zurich, final grade 4.25, one year, no production ML) | Tutor asks what Emilie would do with him, or stays quiet |
| 2 | Leave the track on Standard loop and click **Advance to interview** | Tutor stops it before you confirm, asks why Emilie would stop here, and replays her ETH moment |
| 3 | Cancel, change **Track** to Fast track | |
| 4 | Click **Advance to interview** again without an interviewer | Tutor stops it again: no interviewer, no fast track |
| 5 | Cancel, set an interviewer, advance and confirm | Tutor stays quiet or confirms briefly |
| 6 | Open C-111, Sara Keller (PhD UZH, final grade 6.0, eight years of production ML, a NeurIPS paper). Click **Advance to interview** | Tutor stops it before you confirm: UZH applications are held until Reto has looked at them |
| 7 | Cancel, click **Hold** and confirm | Tutor stays quiet or confirms briefly |
| 8 | Open C-114, Chloé Martin (BSc HEC Lausanne, final grade 4.0, no experience). Leave the track on Standard loop and click **Advance to interview** | Tutor stops it before you confirm and replays the HEC Lausanne moment |
| 9 | Cancel, change **Track** to Fast track, set an interviewer, advance and confirm | Tutor stays quiet or confirms briefly |
| 10 | Open C-113, Lea Fischer (MSc University of Bern, final grade 5.0, two years). Leave the standard track, click **Advance to interview** and confirm | Nothing should happen. No rule applies to her |

C-112, David Chen (MSc EPFL, currently at Helvetia Ventures, an investor), is there for the CEO rule: pressing **Advance to interview** should be stopped, **Hold** or **Send to the founders** should pass.

## What to write down

- Each time the apprentice spoke in Part 1: was it during a Stop, or did it cut in while you were talking or clicking?
- Any Stop where it should have asked and did not.
- Whether it ever replied to your think-aloud lines (it should not).
- Whether its questions were about what was on screen, and whether at least one was about a limit or a stop-and-ask rule.
- In Part 2: which gaps it asked, whether the teach-back was correct, and whether the map shows the ETH, HEC Lausanne, UZH, referral and CEO rules afterwards.
- In Part 3: whether the tutor stepped in before the confirm at steps 2, 4, 6 and 8, and whether it stayed quiet on C-113.
