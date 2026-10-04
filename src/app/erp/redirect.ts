// The sandbox moved from /erp to /hiring. Old links keep working.

import { redirect } from "next/navigation";

export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// Redirects to `path` and keeps the query string.
export async function redirectWithQuery(path: string, searchParams: SearchParams): Promise<never> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (value === undefined) continue;
    // ?invoice= is the old name of ?candidate=.
    const name = key === "invoice" ? "candidate" : key;
    for (const v of Array.isArray(value) ? value : [value]) query.append(name, v);
  }
  const qs = query.toString();
  redirect(qs ? `${path}?${qs}` : path);
}
