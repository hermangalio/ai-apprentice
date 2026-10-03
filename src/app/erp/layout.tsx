import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AP Workbench (sandbox)",
  description: "Sandbox accounts payable system",
};

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 text-slate-900">{children}</div>;
}
