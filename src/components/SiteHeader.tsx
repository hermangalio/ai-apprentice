"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 4 5 27h5.2l2.2-5h7.2l2.2 5H27L16 4Zm0 9.6 2.4 5.4h-4.8L16 13.6Z" fill="#4f46e5" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-stone-900">
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
  if (pathname.startsWith("/erp")) return null;
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-[#faf9f7]/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" aria-label="The AI Apprentice, home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-7 text-xs font-medium text-stone-500 sm:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-stone-900">
              {l.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/capture"
          className="rounded-lg border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-900 shadow-sm hover:border-stone-300"
        >
          Start capturing
        </Link>
      </div>
    </header>
  );
}
