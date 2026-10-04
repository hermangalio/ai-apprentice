import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gipfel AI, Hiring desk (sandbox)",
  description: "Sandbox hiring desk for screening job applications",
};

export default function HiringLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 text-slate-900">{children}</div>;
}
