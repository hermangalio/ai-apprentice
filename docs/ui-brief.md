# The AI Apprentice — UI/UX-Brief für Redesign-Mockups

> Zweck dieses Dokuments: Vorlage für ein Bild-/Design-Modell (ChatGPT, Midjourney, Figma AI o. ä.),
> um bessere UI-Entwürfe für diese bestehende App zu erzeugen. Alle UI-Texte sind auf Englisch —
> bitte im Design beibehalten.

---

## 1. Was das Produkt ist

**The AI Apprentice** ist ein Hackathon-MVP (ElevenLabs × Hack-Nation, 7th Global AI Hackathon).

Das Problem: Erfahrene Mitarbeitende gehen in Rente und nehmen jahrzehntelanges Urteilsvermögen über
digitale Büroarbeit mit. Screen-Recordings zeigen *was* geklickt wurde, nie *warum*. Guardrails
(Limits, Ausnahmen, „hier musst du nachfragen") stehen nirgends geschrieben.

Die Lösung: Ein „Lehrling" (Apprentice), der über Screen-Sharing zusieht, wie eine Expertin arbeitet,
per Sprache an natürlichen Pausen nachfragt, daraus eine klickbare **Work Map** baut und diese
anschliessend einer neuen Person als Sprach-Tutor beibringt.

Leitsatz aus dem Challenge-Brief: *„An apprentice, not a recorder."*

### Laufendes Beispiel (die Personas im Produkt)
- **Sabine**, 57, leitet seit 24 Jahren die Kreditorenbuchhaltung bei einem Maschinenbauer bei
  Stuttgart. Sie ist die **Expertin**.
- **Lena**, 26, hat am Montag angefangen. Sie ist die **Lernende**.
- Aufgabe: *„Process supplier invoices before month-end close."*

---

## 2. Die drei Module (= die drei Hauptflows)

```
1. CAPTURE  →  2. MAP  →  3. TEACH
Expertin       Work Map      Neue Person
arbeitet,      entsteht      arbeitet,
Agent fragt    im Debrief    Tutor greift ein
```

Dazu kommt ein viertes, bewusst hässliches Ding: ein **Sandbox-ERP** („AP Workbench"), das ein
Legacy-Buchhaltungssystem simuliert. Es läuft in einem zweiten Browser-Tab/-Fenster *neben* der App.
Das ist zentral fürs Layout: **Capture und Teach müssen neben einem zweiten Fenster funktionieren.**

---

## 3. Die Screens im Detail (aktueller Stand)

### 3.1 Landing `/`

Extrem minimal, praktisch ungestaltet.

```
┌──────────────────────────────────────────────┐
│  The AI Apprentice                           │  h1, 30px, semibold
│  It watches how the work is done, asks why,  │  18px, grau
│  and teaches the next person.                │
│                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐         │  3 Karten, nur Rahmen
│  │1.Capture│ │2. Map   │ │3. Teach │         │  Titel + 2 Zeilen Text
│  └─────────┘ └─────────┘ └─────────┘         │
│                                              │
│  Sandbox ERP                                 │  nur ein unterstrichener Link
└──────────────────────────────────────────────┘
```
Kartentexte:
- *1. Capture* — „An expert shares their screen and works. The apprentice watches and asks why at natural pauses."
- *2. Map* — „A spoken debrief closes the gaps and produces the Work Map."
- *3. Teach* — „A new hire works a case they have not seen. The tutor steps in before a guardrail is broken."

---

### 3.2 Capture `/capture`

**Schritt A — Setup-Formular** (schmal, max 576px): Überschrift *„Show the apprentice how you work"*,
zwei Textfelder (*Your name*, *The task you will do*), Button *Start session* (schwarz) und
*Open the sandbox ERP* (Outline).

**Schritt B — Laufende Session** (max 768px, einspaltig):

```
┌─────────────────────────────────────────────────────────┐
│ Sabine: Process supplier invoices    Open the sandbox ERP│
├─────────────────────────────────────────────────────────┤
│ ● Recording   [Stop sharing] [Pause] [Off the record]    │  Status-Pille,
│                                                          │  roter pulsierender Punkt
├─────────────────────────────────────────────────────────┤
│ Watching quietly              3 questions asked          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ● Apprentice                               [Stop]   │ │  VOICE PANEL
│ │   Quiet while you work · transcript: live           │ │
│ │ ─────────────────────────────────────────────────── │ │
│ │ Apprentice  Why did you move that to 0400?          │ │
│ │ Sabine      Because it's over five thousand...      │ │
│ └─────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│ What the apprentice saw (14)                             │
│ 00:12  Invoice 4471 opened                      [DOM]    │  EVENT FEED
│ 00:34  Cost center changed 4711 → 0400          [DOM]    │  mono-Zeitstempel
│ 00:41  Scrolled to the PO list                [VISION]   │
├─────────────────────────────────────────────────────────┤
│ [Task done, start the debrief]                           │
└─────────────────────────────────────────────────────────┘
```

**Zustände, die sichtbar sein müssen:**
- Aufnahme-Status: `Recording` (rot, pulsierend) / `Paused, nothing is sent` (bernstein) /
  `Waiting for screen selection` / `Not recording` (grau)
- Agent-Phase: `Watching quietly` → `Pause noticed, choosing a question` → `Asking` →
  `Listening to the answer`
- Mikrofon-Gate: Der Agent hört nur in Frage-Fenstern zu. Punkt-Farben: indigo+puls = Agent spricht,
  bernstein = still während Arbeit, smaragd = hört zu, grau = aus
- **„Off the record"**: löscht die letzten 30 Sekunden (Frames, Events, Transkript) und pausiert.
  Datenschutz-Feature, muss Vertrauen ausstrahlen.
- Fehlerbanner: rot, wenn die Live-Transkription ausfällt

---

### 3.3 Work Map `/map/[id]` — der Schaustück-Screen

Breitestes Layout (bis 1400px), warmer Hintergrund `#f6f5f1`, zweispaltig: Inhalt + 380px Sidebar.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ WORK MAP, LEARNED FROM SABINE                    [Export for agents (.md)]│
│ Process supplier invoices before month-end close          ┌──────────┐    │
│ 7 steps / 3 judgment calls / 4 guardrails                 │ ● Draft  │    │
└──────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────┐ ┌─────────────────────────┐
│  TIMELINE (horizontal, scrollbar)          │ │ Debrief                 │
│  00:00  00:34  01:12  02:40  03:12  04:05  │ │ ┌─────────────────────┐ │
│   (1)────(2)───◆3◆────(4)────◆5◆────(6)    │ │ │ 2 gaps still open   │ │ bernstein
│  Open   Check  Re-code Hold  Send   Post   │ │ └─────────────────────┘ │
│                 🛡1          🛡2            │ │ ┌─────────────────────┐ │
│  ◆ judgment call   🛡 guardrails            │ │ │ ● Debrief  [Stop]   │ │ VOICE
├────────────────────────────────────────────┤ │ └─────────────────────┘ │
│ STEP 3 OF 7                        [←] [→] │ │ GAPS (2 of 4 closed)    │
│ Re-code to capex            ◆ Judgment call│ │ ✓ Why 0400 and not...   │
│ ┌───────────────┐ ┌──────────────────────┐ │ │ ✓ What makes a supp...  │
│ │               │ │ SCREEN MOMENT 03:12  │ │ │ ○ When do you hold?     │ offen
│ │  SCREENSHOT   │ │ DECISION  Re-coded…  │ │ │ ○ Who approves >10k?    │
│ │   16:9        │ │ REASON    „Anything  │ │ ├─────────────────────────┤
│ │               │ │   over five thousand │ │ │ TEACH-BACK              │
│ │               │ │   is capex."         │ │ │ Waiting for confirmation│
│ │               │ │   Sabine, live 03:14 │ │ │ „So: you open the…"     │
│ └───────────────┘ │ GUARDRAILS           │ │ │ Correction from Sabine: │
│  03:12, invoice   │  [Never] Escalate to │ │ │ „No, December is…"      │
│  4471, cost center│  the controller      │ │ ├─────────────────────────┤
│                   │  „No asset number,   │ │ │ [Merge debrief into map]│
│                   │   no capex booking." │ │ │ [Rebuild draft]         │
│                   │  STILL UNCLEAR       │ │ └─────────────────────────┘
│                   │  ○ When do you hold? │ │
└────────────────────────────────────────────┘
```

**Wichtige visuelle Elemente:**
- **Timeline**: nummerierte Kreise; **Judgment Calls sind um 45° gedrehte Rauten in Bernstein**
  (die Zahl darin bleibt aufrecht); Verbindungslinien; Schild-Icon + Zahl für Guardrails;
  aktiver Schritt dunkel gefüllt. Navigation auch per Pfeiltasten.
- **Guardrail-Typen** als farbige Chips:
  | Typ | Label | Farbe |
  |---|---|---|
  | `limit` | Limit | hellblau (sky) |
  | `exception` | Exception | violett |
  | `stop_and_ask` | Stop and ask | rosé |
  | `never` | Never | fast schwarz, weisse Schrift |
- **Zitate** sind das Herz der Map: Sabines Originalworte, links mit Strich markiert, mit Herkunfts-Badge
  `live` (teal) oder `debrief` (indigo) und Zeitstempel.
- **Gap-Status-Icons**: ✓ grüner Kreis (answered) / ○ bernstein-Ring (open) / – grau (deferred)
- **Status-Badge** oben rechts: `Draft` (bernstein, Punkt) oder `Confirmed` (grün, Häkchen)

---

### 3.4 Teach `/teach/[id]` — schmale Spalte neben dem ERP

**Nur 448px breit (max-w-md)** — gedacht als Seitenpanel neben dem ERP-Fenster. Hintergrund hellgrau.

```
┌────────────────────────────────┐
│ TUTOR · TAUGHT FROM SABINE'S   │
│ Process supplier invoices      │
│ Learner: Lena                  │
├────────────────────────────────┤
│ ● Tutor            [Stop]      │  VOICE PANEL
├────────────────────────────────┤
│ Invoice 4471            open   │  DER FALL
│ Müller GmbH · €7,200 · equip.  │
│ [cost center 4711] [new suppl.]│
├════════════════════════════════┤
│ ⬛ STOP · NOT SAVED YET         │  INTERVENTION (2px Rahmen, bernstein)
│ You're about to post this as   │
│ opex. What did Sabine do with  │
│ equipment over €5,000?         │
│   → Show Sabine's reason       │
│   ┌──────────────────────────┐ │  nach Klick:
│   │ „Anything over five      │ │  Zitat + Regel
│   │  thousand is capex."     │ │  + Mini-Slideshow von
│   │  Sabine's own words      │ │  Sabines Bildschirm
│   │  ┌────────────────────┐  │ │  (Before → Moment → After)
│   │  │ SABINE'S SCREEN    │  │ │
│   │  │   ● ● ●   Replay   │  │ │
│   │  └────────────────────┘  │ │
├────────────────────────────────┤
│ 🔵 YOUR CALL FIRST              │  PREDICTION (hellblau)
│ What would you do with this?   │
│ [_______________________]      │
│ [Show what Sabine does]        │
│   → [I had that] [I missed it] │
├────────────────────────────────┤
│ THE PROCESS, STEP BY STEP      │
│ ✓ 1 Open the invoice           │  grün
│ ⬛ 2 Check the supplier   NOW   │  dunkel + Badge
│   3 Code to a cost center      │  ausgegraut
├────────────────────────────────┤
│ EARLIER IN THIS SESSION        │
│ ● Invoice 4468: No asset…      │
├────────────────────────────────┤
│ [End session and show scorecard]│
└────────────────────────────────┘
```

**Drei Intervention-Zustände (Farbe trägt die Bedeutung):**
- bernstein, 2px: `Stop · not saved yet` — noch korrigierbar
- grün: `Corrected before saving` — richtig reagiert
- rot: `Saved against a rule · on your practice list` — Regel gebrochen

**Scorecard am Ende** (ersetzt den Inhalt):
```
Scorecard for Lena
┌──────┬──────┬──────┐
│  4   │  1   │ 3/5  │   KPI-Kacheln
│Caught│Saved │Predic│
│before│agains│tions │
│saving│t rule│right │
└──────┴──────┴──────┘
● MASTERED (3)        grün
● PRACTICE NEXT (2)   bernstein, mit Zitat
● NOT SEEN YET (1)    grau
```

---

### 3.5 Sandbox-ERP `/erp` — bewusst „hässlich"

Simuliert ein Legacy-Buchhaltungssystem. **Soll beim Redesign hässlich/nüchtern bleiben** — es ist
die Kulisse, nicht das Produkt. Dunkelblaue Kopfleiste „AP Workbench / Accounts payable, sandbox
system", Umschalter *Expert | Learner* für zwei Rechnungssätze, roter *Reset data*.

- **Queue**: grosse Tabelle (Invoice / Supplier / Description / Amount / Invoice date / Status),
  riesige Mono-Rechnungsnummern, Badges *Group company* (violett) und *New supplier* (rot).
- **Detail**: zwei Spalten — links Fakten (Supplier, Country, Amount, Date, Category), rechts
  *Coding* (Cost center Dropdown, Asset number, Note). Grosser Indikator oben rechts:
  `UNSAVED CHANGES: cost center` (bernstein) bzw. `All changes saved` (grün).
- **Jede Aktion braucht eine Bestätigung**: Post / Hold / Send for approval — eigene farbige Box,
  Button erst nach 700 ms aktiv.
- **Tutor-Durchgriff**: Der Tutor kann ein Feld im ERP **orange pulsieren lassen** (CSS-Animation,
  Ringe nach aussen) und ein Banner einblenden: orange `Tutor: stop, nothing is saved yet` oder
  blau `Tutor`. Bei „stop" sind Bestätigungs-Buttons 4 Sekunden gesperrt.

---

## 4. Aktuelles Design-System (das, was ersetzt werden soll)

| | Ist-Zustand |
|---|---|
| Framework | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Theme | **nur hell**, `color-scheme: light`, kein Dark Mode |
| Schrift | Geist Sans + Geist Mono werden geladen — **aber `body` überschreibt alles mit Arial/Helvetica**. Faktisch läuft die App in Arial. |
| Grautöne | **drei verschiedene Skalen gemischt**: `stone` (Map, Teach), `zinc` (Capture, Voice), `slate` (ERP) |
| Akzente | bernstein = Achtung/offen · smaragd = erledigt · rot/rosé = Regel gebrochen · indigo = Agent spricht · hellblau = Vorhersage-Frage · violett = Ausnahme |
| Formen | `rounded-lg` / `rounded-xl`, 1px-Rahmen, kaum Schatten, keine Illustrationen, keine Icon-Bibliothek (nur 4 handgezeichnete Inline-SVGs) |
| Navigation | **existiert nicht** — kein globaler Header, kein Zurück-Weg von Capture/Map/Teach |

---

## 5. Die konkreten Schwachstellen (bitte im Redesign lösen)

1. **Kein Markenauftritt.** Die Landing Page sind drei leere Rahmen. Nichts erzählt in drei Sekunden,
   worum es geht.
2. **Drei Grau-Paletten** nebeneinander — die App wirkt wie drei verschiedene Produkte.
3. **Geist wird geladen, aber von Arial überschrieben** — reine Typografie-Panne.
4. **Keine globale Navigation.** Der Fortschritt Capture → Map → Teach ist nirgends sichtbar.
5. **Die Stimme ist die Kerninteraktion — und hat nur einen 10px-Punkt.** Es gibt keine Wellenform,
   keinen Pegel, keine Antwort darauf, ob gerade zugehört wird.
6. **Auf der Capture-Seite fehlt genau das, worum es geht:** der geteilte Bildschirm wird nie gezeigt,
   nur eine Textliste von Events.
7. **Sehr viel 11px-Text**, dichte Blöcke, schwache Hierarchie — besonders in der Teach-Spalte.
8. **Keine Zuständigkeit für Leere/Laden/Fehler** ausser grauem Fliesstext.
9. **Zwei-Fenster-Setup wird nicht erklärt.** Dass App und ERP nebeneinander gehören, erfährt man nie.
10. **Nicht responsiv.** Die Work Map braucht 1400px, die Timeline 720px Mindestbreite.

---

## 6. Gewünschte Bilder (Auftrag an das Bildmodell)

Erzeuge hochauflösende, realistische **UI-Mockups** (keine Fotos, keine 3D-Renderings) im Stil
moderner SaaS-Produkte. Hell, ruhig, hoher Kontrast, viel Weissraum. Eine einzige, konsistente
Grautonpalette und **eine** Akzentfarbe plus das Ampel-System (bernstein/grün/rot) für Zustände.
Keine Platzhalter-Lorem-Ipsum — nutze die echten Texte oben.

Bitte diese Ansichten, jeweils als Desktop-Screenshot 16:9:

1. **Landing Page** — Hero mit dem Satz „It watches how the work is done, asks why, and teaches the
   next person.", der Drei-Schritt-Flow Capture → Map → Teach als visuelle Progression,
   dezenter Hinweis auf das Sabine/Lena-Szenario.
2. **Capture, laufende Session** — geteilter Bildschirm als Live-Vorschau links, Voice-Panel mit
   echter Audio-Visualisierung rechts, Event-Feed darunter, prominenter Aufnahme-Status und ein
   vertrauenerweckender „Off the record"-Knopf.
3. **Work Map** — der Hauptscreen. Horizontale Timeline mit Rauten für Judgment Calls,
   Screenshot + Begründung als Zitat, Guardrail-Chips, Debrief-Sidebar mit Gap-Checkliste.
4. **Work Map, Zustand „Confirmed"** — dieselbe Ansicht, alle Gaps geschlossen, grünes Badge.
5. **Teach, Seitenpanel neben dem ERP** — zeige **beide Fenster nebeneinander**: links das nüchterne
   ERP mit einem orange pulsierenden Feld, rechts die schmale Tutor-Spalte mit einer aktiven
   bernsteinfarbenen Intervention.
6. **Teach, Intervention aufgeklappt** — Zitat von Sabine plus die Mini-Slideshow ihres Bildschirms
   (Before / Moment / After).
7. **Scorecard** — drei KPI-Kacheln, darunter Mastered / Practice next / Not seen yet.
8. *(optional)* **Mobile/Tablet-Variante** der Work Map — wie die Timeline vertikal funktionieren könnte.

### Randbedingungen für die Entwürfe
- Muss mit **Tailwind CSS v4** ohne Zusatzbibliotheken umsetzbar sein.
- **Nur Light Mode.**
- Capture und Teach müssen **neben einem zweiten Browserfenster** funktionieren → schmale Spalten
  bleiben Pflicht.
- Alle Screenshots im Produkt sind echte, gespeicherte JPEG-Frames im Seitenverhältnis 16:9.
- Die Zitate der Expertin sind das wertvollste Element — sie dürfen typografisch Gewicht bekommen.
- Keine erfundenen Features. Alles oben Beschriebene existiert bereits im Code.
