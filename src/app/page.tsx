import Link from "next/link";

const MODULES = [
  { href: "/capture", title: "1. Capture", text: "An expert shares their screen and works. The apprentice watches and asks why at natural pauses." },
  { href: "/map/fixture_sabine", title: "2. Map", text: "A spoken debrief closes the gaps and produces the Work Map. This link opens the example map." },
  { href: "/teach", title: "3. Teach", text: "A new hire works a case they have not seen. The tutor steps in before a guardrail is broken." },
];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-10 text-stone-900">
      <h1 className="text-3xl font-semibold">The AI Apprentice</h1>
      <p className="text-lg text-stone-600">It watches how the work is done, asks why, and teaches the next person.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href} className="rounded-lg border border-stone-200 p-4 hover:border-stone-400">
            <div className="font-semibold">{m.title}</div>
            <p className="mt-1 text-sm text-stone-600">{m.text}</p>
          </Link>
        ))}
      </div>
      <Link href="/erp" className="text-sm underline">
        Sandbox ERP
      </Link>
    </main>
  );
}
