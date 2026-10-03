import type { Metadata } from "next";
import { WorkMapView } from "@/components/map/WorkMapView";
import { isReadOnly } from "@/lib/map/patch";
import { sessions, workMaps } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Work Map" };

export default async function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, map, readOnly] = await Promise.all([sessions.get(id), workMaps.get(id), isReadOnly(id)]);
  return (
    <WorkMapView
      sessionId={id}
      initialMap={map}
      sessionFound={!!session}
      task={session?.task ?? map?.task ?? ""}
      expertName={session?.personName ?? map?.expertName ?? ""}
      readOnly={readOnly}
    />
  );
}
