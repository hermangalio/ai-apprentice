"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { DEFAULT_PERSON_NAME, usePersonName } from "@/lib/profile";

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {/* The A, and the lighter stroke that sweeps across it. */}
      <path d="M16 3.5 4.6 28h5.6l2.2-5.2h7.2L21.8 28h5.6L16 3.5Zm0 9.9 2.3 5.2h-4.6L16 13.4Z" fill="#1668e0" />
      <path d="M6.5 13.5C12 9 20 8.2 26.5 11.4" stroke="#6ea8f5" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight text-stone-900">
      <LogoMark />
      The AI Apprentice
    </span>
  );
}

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/map/fixture_sabine", label: "Work maps" },
  { href: "/teach", label: "Teach" },
];

// Top bar for every page except the sandbox ERP, which stands in for the
// customer's own system and must not look like part of this app.
export function SiteHeader() {
  const pathname = usePathname();
  const personName = usePersonName();
  if (pathname.startsWith("/erp")) return null;
  // The capture flow is a focused task: the bar carries only the wordmark and
  // who is recording, as in the design.
  const focused = pathname.startsWith("/capture");

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" aria-label="The AI Apprentice, home">
          <Wordmark />
        </Link>
        {!focused && (
          <nav className="hidden items-center gap-7 text-sm font-medium text-stone-500 sm:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-stone-900">
                {l.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-4">
          {!focused && (
            <Link
              href="/capture"
              className="rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-sm font-semibold text-stone-900 shadow-sm hover:border-stone-300"
            >
              Start capturing
            </Link>
          )}
          <span title={personName ?? undefined}>
            <Avatar name={personName ?? DEFAULT_PERSON_NAME} size={36} />
          </span>
        </div>
      </div>
    </header>
  );
}
