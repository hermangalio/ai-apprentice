"use client";

import { useCallback, useEffect, useState } from "react";
import { TeachPanel, type VoiceWiring } from "@/components/teach/TeachPanel";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { useTutorVoice } from "@/lib/teach/useTutorVoice";
import type { Session } from "@/lib/types";

// Client wrapper for the tutor page: the tutor panel plus the voice agent.
// Interventions and prediction questions from the panel are spoken by the
// agent (kept until the voice connects if it is not connected yet), and the
// agent is told each learner step as a "Screen:" line.
export function TeachScreen({ learnerSessionId }: { learnerSessionId: string }) {
  // Finds the voice panel through the registry (same session id).
  const voice = useTutorVoice(learnerSessionId);
  const [names, setNames] = useState<{ learner?: string; expert?: string; task?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const learner: Session | null = await fetch(`/api/sessions/${learnerSessionId}`).then((r) => (r.ok ? r.json() : null));
      if (!learner) return;
      const expert: Session | null = learner.workMapSessionId
        ? await fetch(`/api/sessions/${learner.workMapSessionId}`).then((r) => (r.ok ? r.json() : null))
        : null;
      if (!cancelled) setNames({ learner: learner.personName, expert: expert?.personName, task: learner.task });
    })();
    return () => {
      cancelled = true;
    };
  }, [learnerSessionId]);

  const voiceSlot = useCallback(
    (wiring: VoiceWiring) => (
      <VoicePanel
        mode="tutor"
        sessionId={wiring.sessionId}
        context={wiring.context}
        clientTools={wiring.clientTools}
        personName={names.learner}
        expertName={names.expert}
        task={names.task}
      />
    ),
    [names],
  );

  return (
    <TeachPanel
      learnerSessionId={learnerSessionId}
      voiceSlot={voiceSlot}
      onIntervention={voice.speak}
      onSettled={voice.settle}
      onLearnerEvent={voice.screen}
    />
  );
}
