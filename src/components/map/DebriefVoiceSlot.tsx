"use client";

import { VoicePanel } from "@/components/voice/VoicePanel";
import type { DebriefClientTools } from "@/lib/map/debriefTools";

// The debrief voice agent. `context` is debriefContext(workMap) and
// `clientTools` is debriefClientTools(sessionId, onChange); both are prepared
// by WorkMapView.
export type DebriefVoiceSlotProps = {
  sessionId: string;
  context: string;
  clientTools: DebriefClientTools;
};

export function DebriefVoiceSlot({ sessionId, context, clientTools }: DebriefVoiceSlotProps) {
  return <VoicePanel mode="debrief" sessionId={sessionId} context={context} clientTools={clientTools} />;
}
