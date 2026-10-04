import { redirectWithQuery, type SearchParams } from "./redirect";

export default async function ErpPage({ searchParams }: { searchParams: SearchParams }) {
  await redirectWithQuery("/hiring", searchParams);
}
