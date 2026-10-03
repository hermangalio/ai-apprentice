// Client-side handlers for the tools the tutor voice agent calls. Pass the
// result as `clientTools` to the voice panel. Each handler returns a short
// string that goes back to the agent as the tool result.

export type ShowExpertMomentArgs = { guardrail_id?: string; step_id?: string };
export type LogPredictionArgs = {
  step_id: string;
  prompt: string;
  learner_answer?: string;
  correct?: boolean | string;
};
export type LogInterventionOutcomeArgs = { guardrail_id: string; outcome: "corrected" | "overridden" | string };

export type TutorToolCallbacks = {
  // Open the replay in the panel. May return the moment's label for the agent.
  onShowExpertMoment?: (target: { guardrailId?: string; stepId?: string }) => string | void;
  onPrediction?: (p: { stepId: string; prompt: string; learnerAnswer?: string; correct?: boolean }) => void;
  onOutcome?: (o: { guardrailId: string; outcome: "corrected" | "overridden" }) => void;
};

export type TutorClientTools = {
  show_expert_moment: (args: ShowExpertMomentArgs) => Promise<string>;
  log_prediction: (args: LogPredictionArgs) => Promise<string>;
  log_intervention_outcome: (args: LogInterventionOutcomeArgs) => Promise<string>;
};

async function post(body: unknown): Promise<Response> {
  return fetch("/api/teach/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function tutorClientTools(learnerSessionId: string, callbacks: TutorToolCallbacks = {}): TutorClientTools {
  return {
    async show_expert_moment(args) {
      const guardrailId = args?.guardrail_id || undefined;
      const stepId = args?.step_id || undefined;
      if (!guardrailId && !stepId) return "Nothing shown: give a guardrail_id or a step_id.";
      const label = callbacks.onShowExpertMoment?.({ guardrailId, stepId });
      return label ? `Showing the expert's screen: ${label}.` : "Showing the expert's screen moment.";
    },

    async log_prediction(args) {
      const correct =
        typeof args.correct === "boolean" ? args.correct : args.correct === "true" ? true : args.correct === "false" ? false : undefined;
      const p = { stepId: args.step_id, prompt: args.prompt, learnerAnswer: args.learner_answer, correct };
      try {
        const res = await post({ learnerSessionId, type: "prediction", ...p });
        if (!res.ok) return `Prediction not logged: ${(await res.json().catch(() => ({}))).error ?? res.status}`;
      } catch {
        return "Prediction not logged: the server could not be reached.";
      }
      callbacks.onPrediction?.(p);
      return "Prediction logged.";
    },

    async log_intervention_outcome(args) {
      const outcome = args.outcome === "overridden" ? "overridden" : "corrected";
      try {
        const res = await post({ learnerSessionId, type: "outcome", guardrailId: args.guardrail_id, outcome });
        if (!res.ok) return `Outcome not logged: ${(await res.json().catch(() => ({}))).error ?? res.status}`;
      } catch {
        return "Outcome not logged: the server could not be reached.";
      }
      callbacks.onOutcome?.({ guardrailId: args.guardrail_id, outcome });
      return "Outcome logged.";
    },
  };
}
