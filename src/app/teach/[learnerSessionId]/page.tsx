import { TeachScreen } from "./TeachScreen";

export const metadata = { title: "Tutor" };

// The tutor side panel. The learner keeps it next to the ERP tab.
export default async function TeachPage({ params }: { params: Promise<{ learnerSessionId: string }> }) {
  const { learnerSessionId } = await params;
  return <TeachScreen learnerSessionId={learnerSessionId} />;
}
