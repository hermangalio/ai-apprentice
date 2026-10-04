import Link from "next/link";
import { LogoMark, Wordmark } from "@/components/SiteHeader";

const btnPrimary =
  "inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700";
const btnGhost =
  "inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 shadow-sm hover:border-stone-300";

export default function Home() {
  return (
    <main className="flex-1 text-stone-900">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <svg className="pointer-events-none absolute right-0 top-10 hidden w-[55%] max-w-3xl md:block" viewBox="0 0 600 200" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="wave" x1="0" x2="1">
              <stop offset="0" stopColor="#4b13ab" stopOpacity="0" />
              <stop offset="0.5" stopColor="#4b13ab" stopOpacity="0.9" />
              <stop offset="1" stopColor="#4b13ab" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <path d="M0 150 C 90 150, 130 40, 230 60 S 360 150, 440 90 S 560 20, 600 40" stroke="url(#wave)" strokeWidth="2" />
          <circle cx="440" cy="90" r="46" fill="#4b13ab" opacity="0.06" />
        </svg>
        <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
          <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Turn experience into shared knowledge.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-stone-600">
            An AI apprentice that learns how your team works, understands why, and teaches the next person.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/capture" className={btnPrimary}>
              Get started <span aria-hidden="true">→</span>
            </Link>
            <a href="#how" className={btnGhost}>
              <span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full border border-indigo-600 text-[8px] text-indigo-600">
                ▶
              </span>
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-5 pb-8">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">How does it work?</h2>
          <p className="mt-3 text-stone-500">From one expert&apos;s experience to your team&apos;s shared knowledge.</p>
        </div>

        <div className="flex flex-col gap-20 sm:gap-28">
          <Step
            n="01"
            tag="Capture"
            title="Show how you work."
            text="Share your screen and work as usual. The apprentice watches the steps, listens, and saves the moments that matter. Nothing is asked while you are in the middle of something."
            href="/capture"
            cta="Start a capture session"
            visual={<CaptureMock />}
          />
          <Step
            flip
            n="02"
            tag="Clarify"
            title="Explain the why."
            text="When you pause, the apprentice asks one short, focused question about what it just saw, so the reasoning behind a decision is saved along with the decision."
            visual={<ClarifyMock />}
          />
          <Step
            n="03"
            tag="Review"
            title="Make the knowledge yours."
            text="A spoken debrief closes the gaps and produces the Work Map. Review the steps, correct the details, and confirm what the apprentice learned."
            href="/map/fixture_sabine"
            cta="Open the example Work Map"
            visual={<MapMock />}
          />
          <Step
            flip
            n="04"
            tag="Teach"
            title="Help the next person grow."
            text="A new hire works a case they have not seen. The tutor steps in before a guardrail is broken and turns confirmed knowledge into guided practice."
            href="/teach"
            cta="Start practising"
            visual={<TeachMock />}
          />
        </div>
      </section>

      {/* Closing call to action */}
      <section className="mx-auto mt-24 max-w-6xl px-5">
        <div className="rounded-3xl bg-indigo-50 px-6 py-14 text-center ring-1 ring-indigo-100">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Keep your team&apos;s expertise growing.</h2>
          <p className="mt-3 text-stone-600">Capture what matters. Pass it on.</p>
          <Link href="/capture" className={`${btnPrimary} mt-7`}>
            Get started <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <footer className="mx-auto mt-16 flex max-w-6xl items-center justify-between gap-4 border-t border-stone-200/70 px-5 py-8 text-xs text-stone-500">
        <Wordmark />
        <Link href="/hiring?set=expert" className="hover:text-stone-900">
          Hiring desk sandbox
        </Link>
      </footer>
    </main>
  );
}

function Step({
  n,
  tag,
  title,
  text,
  href,
  cta,
  visual,
  flip,
}: {
  n: string;
  tag: string;
  title: string;
  text: string;
  href?: string;
  cta?: string;
  visual: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={flip ? "md:order-2" : ""}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
          {n} / {tag}
        </p>
        <h3 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h3>
        <p className="mt-4 max-w-md leading-relaxed text-stone-600">{text}</p>
        {href && cta && (
          <Link href={href} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700">
            {cta} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      <div className={flip ? "md:order-1" : ""}>{visual}</div>
    </div>
  );
}

/* ---- Product mockups. Illustrative only: they show what each module does. ---- */

function Window({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_20px_50px_-24px_rgba(20,20,43,0.25)]" aria-hidden="true">
      <div className="flex items-center gap-1.5 border-b border-stone-100 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        {title && <span className="ml-3 text-[11px] font-semibold text-stone-700">{title}</span>}
      </div>
      {children}
    </div>
  );
}

function Bar({ w, accent }: { w: string; accent?: boolean }) {
  return <div className={`h-2 rounded-full ${accent ? "bg-indigo-200" : "bg-stone-200"}`} style={{ width: w }} />;
}

function CaptureMock() {
  return (
    <Window title="Capture session">
      <div className="grid grid-cols-[1.3fr_1fr]">
        <div className="space-y-3 bg-stone-50 p-5">
          <Bar w="35%" />
          <Bar w="90%" />
          <Bar w="80%" />
          <div className="rounded-md bg-indigo-100 px-3 py-2">
            <Bar w="55%" accent />
          </div>
          <Bar w="70%" />
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-50">
              <LogoMark size={20} />
            </span>
            <div>
              <p className="text-xs font-semibold">Watching quietly</p>
              <p className="text-[11px] text-stone-500">Microphone listening</p>
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Saw</p>
            <p className="mt-1 text-xs font-medium">Application C-103 opened</p>
            <p className="text-[11px] text-stone-500">Priya Nair, PhD EPFL, referred by Luca</p>
          </div>
        </div>
      </div>
    </Window>
  );
}

function ClarifyMock() {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_20px_50px_-24px_rgba(20,20,43,0.25)]" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
        One thing to clarify
      </span>
      <p className="mt-3 rounded-xl bg-stone-50 px-4 py-3 text-sm font-medium">Why did you move Nina from the standard loop to the fast track?</p>
      <div className="my-5 flex items-center justify-between gap-4">
        <div className="flex h-10 items-center gap-[3px]">
          {[6, 14, 22, 12, 30, 18, 34, 20, 26, 10, 22, 14, 8, 18, 12, 6].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-indigo-500" style={{ height: h }} />
          ))}
        </div>
        <span className="ai-pulse inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">Answer by voice</span>
      </div>
      <div className="rounded-xl border border-stone-200 bg-indigo-50/40 p-4">
        <p className="text-sm text-stone-700">She&rsquo;s from ETH. ETH goes straight to the founders…</p>
        <div className="mt-3 space-y-2">
          <Bar w="85%" accent />
          <Bar w="60%" accent />
        </div>
      </div>
    </div>
  );
}

function MapMock() {
  const steps = ["Open the application", "Check the university", "Choose the interview track", "Assign an interviewer", "Advance or hold"];
  return (
    <Window title="Work Map">
      <div className="grid grid-cols-[0.9fr_1.3fr]">
        <ol className="space-y-3 border-r border-stone-100 p-5">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2.5 text-[11px]">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${i === 3 ? "bg-indigo-600 text-white" : "border border-stone-300 text-stone-500"}`}>
                {i + 1}
              </span>
              <span className={i === 3 ? "font-semibold text-stone-900" : "text-stone-500"}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">Expert reasoning</p>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Expert confirmed</span>
          </div>
          <p className="mt-3 border-l-2 border-indigo-300 pl-3 text-xs italic text-stone-600">&ldquo;No interviewer, no fast track. If nobody is free, I ask Reto.&rdquo;</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">
            {[
              ["Steps", "Actions, in order"],
              ["Decisions", "What and why"],
              ["Guardrails", "Things to watch"],
            ].map(([a, b]) => (
              <div key={a} className="rounded-lg border border-stone-200 p-2">
                <p className="font-semibold text-stone-800">{a}</p>
                <p className="mt-0.5 text-stone-500">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Window>
  );
}

function TeachMock() {
  const steps = ["Open the application", "Check the university", "Choose the interview track", "Advance to interview"];
  return (
    <Window title="Practice">
      <div className="grid grid-cols-[0.9fr_1.3fr]">
        <ol className="space-y-2 border-r border-stone-100 p-5">
          <li className="mb-1 text-[11px] font-semibold text-stone-800">Your practice</li>
          {steps.map((s, i) => (
            <li key={s} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${i === 2 ? "bg-indigo-50 font-semibold text-indigo-700" : "text-stone-500"}`}>
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${i === 2 ? "bg-indigo-600 text-white" : "border border-stone-300"}`}>{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-bold">
              <LogoMark size={16} /> Your tutor
            </p>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Listening</span>
          </div>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Before you advance: what would you check first?</p>
          <span className="inline-flex w-full justify-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Continue practice →</span>
        </div>
      </div>
    </Window>
  );
}
