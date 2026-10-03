# Capture test script (expert)

Use this to test the live apprentice during Part 1 (Capture).

## Setup

- Chrome, headphones on, one person speaking.
- Open `http://localhost:3000`.
- In the sandbox ERP, click **Reset data** so all three invoices are open.

## Play-by-play

A **Stop** means: hands off the mouse and keyboard, say nothing, count to four. That is where the apprentice can ask.

| # | Do | Say |
|---|---|---|
| 1 | Click **Capture**, enter your name, click **Start session** | |
| 2 | Click **Open the sandbox ERP** (new tab). Go back, click **Share screen and start**, pick the ERP tab. This also connects the apprentice; allow the microphone if asked | |
| 3 | Wait until the panel shows the apprentice as connected, then switch to the ERP tab | "Okay, month-end close, three invoices to get through." |
| 4 | Open invoice 4471 | "First one. Kessler, tool holders, six thousand eight hundred forty." |
| 5 | Open the purchase order panel | "I check it against the purchase order first. Amounts match, goods are received." |
| 6 | Change cost center to 0400 | "This one goes to capex." |
| 7 | **Stop** | |
| 8 | Type asset number `A-2291` | "Asset number goes in before I post." |
| 9 | **Stop** | |
| 10 | Click Post, then Confirm posting | "Posted." |
| 11 | Back to queue, open 4472, open supplier history | "Brandt, hydraulic fittings, dated December. Let me look at their history. Same amount as one we paid in November." |
| 12 | Click Hold, then confirm | "I'm not posting this one." |
| 13 | **Stop** | |
| 14 | Back to queue, open 4473 | "Novák. That's our Czech subsidiary." |
| 15 | Click Send for second approval, then confirm | "This doesn't get posted by me alone." |
| 16 | **Stop** | |

## How to respond when the apprentice asks

Answer with the matching line, then stay quiet for two seconds before you carry on.

| If it asks about | Say |
|---|---|
| Why capex, or why you changed the cost center | "Equipment over five thousand euros is always capex. It doesn't matter what the default code says." |
| The asset number, or posting without one | "Never. No asset number, no capex booking. If it's missing, I ask asset accounting to create one first." |
| Why you held the Brandt invoice | "Brandt double-bills every December. It waits until I've checked it isn't a duplicate." |
| Why the second approval | "Anything from a group company needs a second signature from the controller, whatever the amount." |
| A limit, or when you would stop and ask someone | "Five thousand euros is the line for capex. And if I don't know the supplier, I stop and ask the controller." |
| Anything else | Answer in one or two sentences, in your own words. |

If it asks nothing at a Stop, carry on. Questions it did not ask should come up in the debrief.

## What to write down

- Each time the apprentice spoke: was it during a Stop, or did it cut in while you were talking or clicking?
- Any Stop where it should have asked and did not.
- Whether it ever replied to your think-aloud lines (it should not).
- Whether its questions were about what was on screen, and whether at least one was about a limit or a stop-and-ask rule.
