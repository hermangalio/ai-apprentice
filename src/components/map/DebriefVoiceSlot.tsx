"use client";

import { useEffect, useState } from "react";
import { VoicePanel } from "@/components/voice/VoicePanel";
import type { DebriefClientTools } from "@/lib/map/debriefTools";
import type { Session } from "@/lib/types";

// The debrief voice agent. `context` is debriefContext(workMap) and
// `clientTools` is debriefClientTools(sessionId, onChange); both are prepared
// by WorkMapView.
export type DebriefVoiceSlotProps = {
  sessionId: string;
  context: string;
  clientTools: DebriefClientTools;
  // The debrief progress card draws its own start button and status, so the
  // panel is asked for the transcript alone.
  controls?: boolean;
  chrome?: "card" | "bare";
  emptyState?: React.ReactNode;
  className?: string;
};

export function DebriefVoiceSlot({
  sessionId,
  context,
  clientTools,
  controls,
  chrome,
  emptyState,
  className,
}: DebriefVoiceSlotProps) {
  // The agent's prompt addresses the expert by name and names the task. The
  // panel reads both when the conversation starts, so it is mounted once the
  // session has been looked up (or the lookup has failed).
  const [loaded, setLoaded] = useState<{ sessionId: string; session: Session | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Session>) : null))
      .catch(() => null)
      .then((session) => {
        if (!cancelled) setLoaded({ sessionId, session });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!loaded || loaded.sessionId !== sessionId) {
    return <p className="text-sm text-stone-500">Loading the session</p>;
  }
  return (
    <VoicePanel
      mode="debrief"
      sessionId={sessionId}
      context={context}
      clientTools={clientTools}
      personName={loaded.session?.personName}
      task={loaded.session?.task}
      controls={controls}
      chrome={chrome}
      emptyState={emptyState}
      className={className}
    />
  );
}
