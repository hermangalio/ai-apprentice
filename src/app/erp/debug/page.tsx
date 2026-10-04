import { redirectWithQuery, type SearchParams } from "../redirect";

export default async function ErpDebugPage({ searchParams }: { searchParams: SearchParams }) {
  await redirectWithQuery("/hiring/debug", searchParams);
}
