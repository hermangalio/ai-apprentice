"use client";

// Sandbox hiring desk of Gipfel AI. Application queue and candidate detail in one client page.
// It enforces no rule: any application can be advanced, held, escalated or rejected,
// on any track, with or without an interviewer.
// Every user step is posted on BroadcastChannel(ERP_CHANNEL), see src/lib/erp/events.ts.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ERP_CONTROL,
  actionCancelledSummary,
  actionRequestedSummary,
  actionSummary,
  candidateOpenedSummary,
  educationOpenedSummary,
  emitErpEvent,
  fieldChangeSummary,
  formatCHF,
  queueOpenedSummary,
  referralOpenedSummary,
  trackLabel,
  workHistoryOpenedSummary,
  yearsLabel,
  type ErpAction,
  type ErpCoachSeverity,
  type ErpConfirmAction,
  type ErpControlMessage,
} from "@/lib/erp/events";
import { TRACKS, type Candidate, type CandidateStatus, type EditableFields, type ErpSet, type Track } from "@/lib/erp/seed";
import { erpStore, hasUnsavedChanges } from "@/lib/erp/store";

const STATUS_LABEL: Record<CandidateStatus, string> = {
  open: "Open",
  advanced: "Advanced to interview",
  on_hold: "On hold",
  escalated: "With the founders",
  rejected: "Rejected",
};

const STATUS_STYLE: Record<CandidateStatus, string> = {
  open: "bg-white text-slate-900 border-slate-500",
  advanced: "bg-green-700 text-white border-green-800",
  on_hold: "bg-amber-500 text-black border-amber-700",
  escalated: "bg-blue-700 text-white border-blue-900",
  rejected: "bg-red-700 text-white border-red-900",
};

const ACTION_STATUS: Record<ErpAction, CandidateStatus> = {
  advance: "advanced",
  hold: "on_hold",
  escalate: "escalated",
  reject: "rejected",
  reopen: "open",
};

type TextKey = "interviewer" | "note";

const HIGHLIGHT_MS = 4000;
// Every confirm button is armed after this pause, so a tutor message sent in
// reply to the request can arrive before the first possible click.
const CONFIRM_ARM_MS = 700;
// Time to read or hear a "stop" coach message before confirming is possible.
const COACH_READ_MS = 4000;
const TEXT_SETTLE_MS = 800; // a text field counts as changed after this pause in typing
const TYPING_PING_MS = 1000;

// A tutor message received on the control channel.
type Coach = { id: number; text: string; field?: string; severity: ErpCoachSeverity; at: number };

const normalizeField = (field: string) => field.trim().toLowerCase().replace(/[\s-]+/g, "_");

// Wording and colors of the action buttons and the confirmation box.
const ACTIONS: Record<ErpConfirmAction, { button: string; label: string; title: (id: string) => string; note: string; confirm: string; box: string; style: string }> = {
  advance: {
    button: "Advance to interview",
    label: "Confirm advancing to interview",
    title: (id) => `Advance application ${id} to interview?`,
    note: "Not advanced yet. The candidate is invited as soon as you confirm.",
    confirm: "Confirm advance",
    box: "border-green-700 bg-green-50",
    style: "bg-green-700 text-white hover:bg-green-800",
  },
  hold: {
    button: "Hold",
    label: "Confirm hold",
    title: (id) => `Put application ${id} on hold?`,
    note: "Not on hold yet. A held application waits until it is reopened.",
    confirm: "Confirm hold",
    box: "border-amber-600 bg-amber-50",
    style: "bg-amber-500 text-black hover:bg-amber-600",
  },
  escalate: {
    button: "Send to the founders",
    label: "Confirm sending to the founders",
    title: (id) => `Send application ${id} to the founders?`,
    note: "Not sent yet. The founders decide on an escalated application.",
    confirm: "Confirm sending",
    box: "border-blue-700 bg-blue-50",
    style: "bg-blue-700 text-white hover:bg-blue-800",
  },
  reject: {
    button: "Reject",
    label: "Confirm rejection",
    title: (id) => `Reject application ${id}?`,
    note: "Not rejected yet. The candidate gets a rejection email as soon as you confirm.",
    confirm: "Confirm rejection",
    box: "border-red-700 bg-red-50",
    style: "bg-red-700 text-white hover:bg-red-800",
  },
};

const ACTION_ORDER: ErpConfirmAction[] = ["advance", "hold", "escalate", "reject"];

function fullTrackLabel(value: string): string {
  return TRACKS.find((t) => t.value === value)?.label ?? value;
}

function StatusBadge({ status }: { status: CandidateStatus }) {
  return (
    <span className={`inline-block rounded border-2 px-3 py-1 text-base font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function HiringPage() {
  const state = useSyncExternalStore(erpStore.subscribe, erpStore.getSnapshot, erpStore.getServerSnapshot);
  const [openId, setOpenId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const coachSeq = useRef(0);
  const started = useRef(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeUrl = useCallback((set: ErpSet, candidateId: string | null) => {
    const params = new URLSearchParams({ set });
    if (candidateId) params.set("candidate", candidateId);
    window.history.replaceState(null, "", `/hiring?${params.toString()}`);
  }, []);

  const showQueue = useCallback(() => {
    const s = erpStore.getSnapshot();
    if (!s) return;
    setCoach(null); // a coach message belongs to the application it was sent for
    setOpenId(null);
    writeUrl(s.set, null);
    emitErpEvent({ kind: "open", summary: queueOpenedSummary(s.sets[s.set]) });
  }, [writeUrl]);

  const openCandidate = useCallback(
    (id: string) => {
      const found = erpStore.find(id);
      if (!found) return;
      erpStore.setSet(found.set);
      setCoach(null);
      setOpenId(id);
      writeUrl(found.set, id);
      emitErpEvent({ kind: "open", summary: candidateOpenedSummary(found.candidate) }, found.candidate);
    },
    [writeUrl],
  );

  const switchSet = useCallback(
    (set: ErpSet) => {
      erpStore.setSet(set);
      showQueue();
    },
    [showQueue],
  );

  // First load: pick the set from the query string, else the remembered one.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("set");
    const s = erpStore.init(q === "expert" || q === "learner" ? q : undefined);
    const candidateId = params.get("candidate") ?? params.get("invoice");
    if (candidateId && erpStore.find(candidateId)) {
      openCandidate(candidateId);
    } else {
      writeUrl(s.set, null);
      emitErpEvent({ kind: "open", summary: queueOpenedSummary(s.sets[s.set]) });
    }
  }, [openCandidate, writeUrl]);

  // Control channel: coaching highlight, tutor banner and remote navigation.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const control = new BroadcastChannel(ERP_CONTROL);
    control.onmessage = (e: MessageEvent<ErpControlMessage>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "highlight" && typeof msg.field === "string") {
        const field = normalizeField(msg.field);
        setHighlight(field);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
        document.querySelector(`[data-erp-field="${CSS.escape(field)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if ((msg.type === "open_candidate" || msg.type === "open_invoice") && typeof msg.id === "string") {
        openCandidate(String(msg.id));
      } else if (msg.type === "coach" && typeof msg.text === "string" && msg.text.trim()) {
        setCoach({
          id: ++coachSeq.current,
          text: msg.text.trim(),
          field: typeof msg.field === "string" && msg.field.trim() ? normalizeField(msg.field) : undefined,
          severity: msg.severity === "stop" ? "stop" : "hint",
          at: Date.now(),
        });
      } else if (msg.type === "coach_clear") {
        setCoach(null);
      }
    };
    return () => control.close();
  }, [openCandidate]);

  if (!state) {
    return <main className="p-8 text-xl">Loading hiring desk ...</main>;
  }

  const candidates = state.sets[state.set];
  const current = openId ? candidates.find((c) => c.id === openId) ?? null : null;

  return (
    <main className="mx-auto w-full max-w-7xl p-6">
      <style>{`
        @keyframes erp-pulse {
          0%, 100% { box-shadow: 0 0 0 4px #f97316, 0 0 0 10px rgba(249, 115, 22, 0.35); }
          50% { box-shadow: 0 0 0 6px #f97316, 0 0 0 20px rgba(249, 115, 22, 0); }
        }
        .erp-highlight { animation: erp-pulse 0.8s ease-in-out infinite; border-radius: 8px; background-color: #ffedd5; color: #0f172a; }
      `}</style>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-900 px-6 py-4 text-white">
        <div>
          <div className="text-2xl font-bold">Gipfel AI, Hiring desk (sandbox)</div>
          <div className="text-base text-slate-300">ETH Zurich spin-off. Open role: ML Engineer</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-slate-300">Application set:</span>
          {(["expert", "learner"] as ErpSet[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => switchSet(s)}
              className={`rounded border-2 px-3 py-1 text-base font-semibold ${
                state.set === s ? "border-white bg-white text-slate-900" : "border-slate-500 text-slate-200 hover:border-white"
              }`}
            >
              {s === "expert" ? "Expert" : "Learner"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (!window.confirm("Reset all applications to their original state?")) return;
              erpStore.reset();
              showQueue();
            }}
            className="ml-4 rounded border-2 border-red-300 px-3 py-1 text-base font-semibold text-red-200 hover:bg-red-900"
          >
            Reset data
          </button>
        </div>
      </header>

      {current ? (
        <CandidateDetail
          key={current.id}
          candidate={current}
          highlight={highlight ?? coach?.field ?? null}
          coach={coach}
          onDismissCoach={() => setCoach(null)}
          onBack={showQueue}
        />
      ) : (
        <Queue candidates={candidates} onOpen={openCandidate} />
      )}
    </main>
  );
}

function Queue({ candidates, onOpen }: { candidates: Candidate[]; onOpen: (id: string) => void }) {
  const open = candidates.filter((c) => c.status === "open").length;
  return (
    <section className="rounded-lg border-2 border-slate-300 bg-white p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Application queue</h1>
        <div className="text-xl font-semibold">
          {open} open of {candidates.length} applications
        </div>
      </div>
      <table className="w-full border-collapse text-left text-xl">
        <thead>
          <tr className="border-b-2 border-slate-900 text-base uppercase tracking-wide text-slate-600">
            <th className="py-3 pr-4">Application</th>
            <th className="py-3 pr-4">Name</th>
            <th className="py-3 pr-4">Role</th>
            <th className="py-3 pr-4">University</th>
            <th className="py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.id} className="cursor-pointer border-b border-slate-300 hover:bg-slate-100" onClick={() => onOpen(c.id)}>
              <td className="py-4 pr-4 font-mono text-2xl font-bold">{c.id}</td>
              <td className="py-4 pr-4 font-semibold">{c.name}</td>
              <td className="py-4 pr-4">{c.role}</td>
              <td className="py-4 pr-4 font-semibold">
                {c.degree} {c.university}
              </td>
              <td className="py-4">
                <button
                  type="button"
                  aria-label={`Open application ${c.id}, status ${STATUS_LABEL[c.status].toLowerCase()}`}
                  className={`inline-block rounded border-2 px-4 py-1.5 text-base font-bold uppercase tracking-wide hover:brightness-95 ${STATUS_STYLE[c.status]}`}
                >
                  {STATUS_LABEL[c.status]}
                </button>
                {hasUnsavedChanges(c) && <div className="mt-1 text-base font-bold text-amber-700">Unsaved changes</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function EmployerBadge({ candidate }: { candidate: Candidate }) {
  if (!candidate.employerRelation) return null;
  return (
    <span className="ml-3 inline-block rounded bg-purple-700 px-3 py-1 text-base font-bold uppercase text-white">
      {candidate.employerRelation === "investor" ? "Investor" : "Customer"}
    </span>
  );
}

function Fact({ label, field, highlight, children }: { label: string; field?: string; highlight: string | null; children: React.ReactNode }) {
  return (
    <div data-erp-field={field} className={`p-2 ${field && highlight === field ? "erp-highlight" : ""}`}>
      <div className="text-sm font-bold uppercase tracking-wide text-slate-600">{label}</div>
      <div className="text-xl font-semibold">{children}</div>
    </div>
  );
}

// Tutor message. Shown inside the confirmation box when one is open,
// otherwise at the top of the application.
function CoachBanner({ coach, onDismiss }: { coach: Coach; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [coach.id]);
  const stop = coach.severity === "stop";
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="coach-banner"
      data-coach-severity={coach.severity}
      className={`flex items-start gap-4 rounded-lg border-4 p-4 ${stop ? "border-orange-600 bg-orange-100" : "border-sky-700 bg-sky-50"}`}
    >
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-bold uppercase tracking-wide ${stop ? "text-orange-900" : "text-sky-900"}`}>
          {stop ? "Tutor: stop, nothing is saved yet" : "Tutor"}
        </div>
        <div className="mt-1 text-2xl font-bold text-slate-900">{coach.text}</div>
      </div>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded border-2 border-slate-900 bg-white px-3 py-1 text-base font-semibold">
        Dismiss
      </button>
    </div>
  );
}

// Collapsible panel. Opening it is reported by the caller as a navigate event.
function Panel({
  title,
  field,
  highlight,
  open,
  onToggle,
  children,
}: {
  title: string;
  field: string;
  highlight: string | null;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section data-erp-field={field} className={`rounded-lg border-2 border-slate-300 bg-white p-5 ${highlight === field ? "erp-highlight" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{title}</h2>
        <button type="button" onClick={onToggle} className="rounded border-2 border-slate-900 bg-white px-4 py-2 text-lg font-semibold">
          {open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
        </button>
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

function CandidateDetail({
  candidate,
  highlight,
  coach,
  onDismissCoach,
  onBack,
}: {
  candidate: Candidate;
  highlight: string | null;
  coach: Coach | null;
  onDismissCoach: () => void;
  onBack: () => void;
}) {
  const [showWork, setShowWork] = useState(false);
  const [showEducation, setShowEducation] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  // The action waiting in the confirmation box, and when the box was opened.
  const [pending, setPending] = useState<{ action: ErpConfirmAction; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Last value reported in a field_change event, per field.
  const reported = useRef<EditableFields>({ ...candidate.draft });
  const timers = useRef<Partial<Record<TextKey, ReturnType<typeof setTimeout>>>>({});
  const lastPing = useRef(0);
  const id = candidate.id;

  const locked = candidate.status !== "open";
  const unsaved = hasUnsavedChanges(candidate);
  const hl = (field: string) => (highlight === field ? "erp-highlight" : "");

  // Emits the pending field_change of a text field, if its value differs from the last reported one.
  const flush = useCallback(
    (key: TextKey) => {
      const t = timers.current[key];
      if (t) clearTimeout(t);
      delete timers.current[key];
      const c = erpStore.find(id)?.candidate;
      if (!c) return;
      const before = reported.current[key];
      const after = c.draft[key];
      if (before === after) return;
      reported.current[key] = after;
      emitErpEvent({ kind: "field_change", summary: fieldChangeSummary(key, before, after), field: key, before, after, committed: false }, c);
    },
    [id],
  );

  const flushAll = useCallback(() => {
    flush("interviewer");
    flush("note");
  }, [flush]);

  // Report a half-typed value when the user leaves the application.
  useEffect(() => flushAll, [flushAll]);

  const changeTrack = (after: Track) => {
    const before = candidate.draft.track;
    if (before === after) return;
    const c = erpStore.updateDraft(id, { track: after });
    if (!c) return;
    reported.current.track = after;
    emitErpEvent({ kind: "field_change", summary: fieldChangeSummary("track", before, after), field: "track", before, after, committed: false }, c);
  };

  const changeText = (key: TextKey, value: string) => {
    const c = erpStore.updateDraft(id, { [key]: value });
    if (!c) return;
    const now = Date.now();
    if (now - lastPing.current >= TYPING_PING_MS) {
      lastPing.current = now;
      emitErpEvent({ kind: "other", summary: "typing", field: key, committed: false }, c);
    }
    const t = timers.current[key];
    if (t) clearTimeout(t);
    timers.current[key] = setTimeout(() => flush(key), TEXT_SETTLE_MS);
  };

  const act = (action: ErpAction) => {
    flushAll();
    const c = erpStore.commit(id, ACTION_STATUS[action]);
    if (!c) return;
    emitErpEvent({ kind: "action", summary: actionSummary(action, c), action, committed: true }, c);
  };

  // Advance, Hold, Send to the founders and Reject are two-step actions: the
  // button opens a confirmation box and nothing is saved until it is
  // confirmed. The request is reported as an uncommitted action so an observer
  // sees the intent first. The sandbox itself checks no rule.
  const requestAction = (action: ErpConfirmAction) => {
    flushAll();
    const c = erpStore.find(id)?.candidate;
    if (!c) return;
    const at = Date.now();
    setPending({ action, at });
    setNow(at);
    emitErpEvent({ kind: "action", summary: actionRequestedSummary(action, c), action, committed: false }, c);
  };

  const cancelAction = () => {
    if (!pending) return;
    setPending(null);
    onDismissCoach(); // the stop message was about the action that is now cancelled
    emitErpEvent({ kind: "other", summary: actionCancelledSummary(pending.action, candidate), committed: false }, candidate);
  };

  const confirmAction = () => {
    if (!pending) return;
    setPending(null);
    act(pending.action);
  };

  // Clock for the confirm button while the confirmation box is open.
  const confirmOpen = pending !== null;
  useEffect(() => {
    if (!confirmOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [confirmOpen]);

  // While a "stop" coach message is showing, confirming waits COACH_READ_MS
  // from the later of: message received, box opened. After that the button
  // works again, so the learner can still go ahead.
  const stopCoach = coach && coach.severity === "stop" ? coach : null;
  const unlockAt = pending
    ? Math.max(pending.at + CONFIRM_ARM_MS, stopCoach ? Math.max(stopCoach.at, pending.at) + COACH_READ_MS : 0)
    : 0;
  const confirmWaitMs = Math.max(0, unlockAt - now);
  const countdown = stopCoach && confirmWaitMs > 0 ? Math.min(Math.ceil(COACH_READ_MS / 1000), Math.ceil(confirmWaitMs / 1000)) : 0;

  const toggleWork = () => {
    const next = !showWork;
    setShowWork(next);
    if (next) emitErpEvent({ kind: "navigate", summary: workHistoryOpenedSummary(candidate) }, candidate);
  };

  const toggleEducation = () => {
    const next = !showEducation;
    setShowEducation(next);
    if (next) emitErpEvent({ kind: "navigate", summary: educationOpenedSummary(candidate) }, candidate);
  };

  const toggleReferral = () => {
    const next = !showReferral;
    setShowReferral(next);
    if (next) emitErpEvent({ kind: "navigate", summary: referralOpenedSummary(candidate) }, candidate);
  };

  const changes: string[] = [];
  if (candidate.draft.track !== candidate.saved.track)
    changes.push(`Track ${trackLabel(candidate.saved.track)} to ${trackLabel(candidate.draft.track)}`);
  if (candidate.draft.interviewer !== candidate.saved.interviewer)
    changes.push(`Interviewer "${candidate.saved.interviewer}" to "${candidate.draft.interviewer}"`);
  if (candidate.draft.note !== candidate.saved.note) changes.push("Note");

  const decisionLine = (fields: EditableFields) =>
    `Track: ${fullTrackLabel(fields.track)}. ${fields.interviewer ? `Interviewer: ${fields.interviewer}` : "No interviewer"}.`;

  const inputClass =
    "w-full rounded border-2 border-slate-900 bg-white px-3 py-2 text-2xl font-semibold text-slate-900 disabled:border-slate-400 disabled:bg-slate-200 disabled:text-slate-700";

  return (
    <div className="flex flex-col gap-5">
      {coach && !(pending && !locked) && <CoachBanner coach={coach} onDismiss={onDismissCoach} />}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={onBack} className="rounded border-2 border-slate-900 bg-white px-4 py-2 text-lg font-semibold">
            Back to queue
          </button>
          <h1 className="text-3xl font-bold">
            Application <span className="font-mono">{candidate.id}</span>
          </h1>
          <span data-erp-field="status" className={hl("status")}>
            <StatusBadge status={candidate.status} />
          </span>
        </div>
        <div
          data-testid="save-indicator"
          className={`rounded border-2 px-4 py-2 text-xl font-bold ${
            unsaved ? "border-amber-700 bg-amber-300 text-black" : "border-green-800 bg-green-100 text-green-900"
          }`}
        >
          {unsaved ? `UNSAVED CHANGES: ${changes.join(", ")}` : locked ? "All changes saved" : "No unsaved changes"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-lg border-2 border-slate-300 bg-white p-5">
          <h2 className="mb-3 text-2xl font-bold">Candidate profile</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Fact label="Name" highlight={highlight}>
                <span className="text-2xl">{candidate.name}</span>
                {candidate.referrer && (
                  <span className="ml-3 inline-block rounded bg-teal-700 px-3 py-1 text-base font-bold uppercase text-white">
                    Referred by {candidate.referrer} (employee)
                  </span>
                )}
              </Fact>
            </div>
            <Fact label="Role applied for" highlight={highlight}>
              {candidate.role}
            </Fact>
            <Fact label="Degree and university" field="university" highlight={highlight}>
              {candidate.degree}, {candidate.university}
            </Fact>
            <Fact label="Years of experience" highlight={highlight}>
              {yearsLabel(candidate.yearsExperience)}
            </Fact>
            <Fact label="Salary expectation" highlight={highlight}>
              <span className="font-mono text-2xl">{formatCHF(candidate.salaryExpectation)}</span>
            </Fact>
            <div className="col-span-2">
              <Fact label="Current employer" field="current_employer" highlight={highlight}>
                {candidate.currentEmployer}
                <EmployerBadge candidate={candidate} />
              </Fact>
            </div>
            <div className="col-span-2">
              <Fact label="From the cover letter" highlight={highlight}>
                <span className="text-lg font-normal">{candidate.coverLetter}</span>
              </Fact>
            </div>
            <div className="col-span-2">
              <Fact label="Hobbies" highlight={highlight}>
                <span className="text-lg font-normal">{candidate.hobbies}</span>
              </Fact>
            </div>
          </div>
        </section>

        <section className="rounded-lg border-2 border-slate-300 bg-white p-5">
          <h2 className="mb-3 text-2xl font-bold">Screening decision</h2>
          <div className="flex flex-col gap-3">
            <label data-erp-field="track" className={`block p-2 ${hl("track")}`}>
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">Track</span>
              <select
                name="track"
                className={inputClass}
                value={candidate.draft.track}
                disabled={locked}
                onChange={(e) => changeTrack(e.target.value as Track)}
              >
                {TRACKS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label data-erp-field="interviewer" className={`block p-2 ${hl("interviewer")}`}>
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">Interviewer</span>
              <input
                name="interviewer"
                type="text"
                autoComplete="off"
                placeholder="(none)"
                className={inputClass}
                value={candidate.draft.interviewer}
                disabled={locked}
                onChange={(e) => changeText("interviewer", e.target.value)}
                onBlur={() => flush("interviewer")}
              />
            </label>
            <label data-erp-field="note" className={`block p-2 ${hl("note")}`}>
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">Note (optional)</span>
              <input
                name="note"
                type="text"
                autoComplete="off"
                className={`${inputClass} text-xl`}
                value={candidate.draft.note}
                disabled={locked}
                onChange={(e) => changeText("note", e.target.value)}
                onBlur={() => flush("note")}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 border-t-2 border-slate-200 pt-4">
            {locked ? (
              <>
                <div className="text-xl font-semibold">
                  Application status: {STATUS_LABEL[candidate.status]}. {decisionLine(candidate.saved)}
                </div>
                <button type="button" onClick={() => act("reopen")} className="rounded border-2 border-slate-900 bg-white px-4 py-2 text-lg font-semibold">
                  Reopen
                </button>
              </>
            ) : (
              ACTION_ORDER.map((a) => (
                <button
                  key={a}
                  type="button"
                  data-erp-field={a}
                  onClick={() => requestAction(a)}
                  className={`rounded px-6 py-3 text-xl font-bold ${ACTIONS[a].style} ${hl(a)}`}
                >
                  {ACTIONS[a].button}
                </button>
              ))
            )}
          </div>
          {pending && !locked && (() => {
            const c = ACTIONS[pending.action];
            return (
              <div role="dialog" aria-label={c.label} data-testid="confirm-box" className={`mt-4 rounded-lg border-4 p-5 ${c.box}`}>
                {coach && (
                  <div className="mb-4">
                    <CoachBanner coach={coach} onDismiss={onDismissCoach} />
                  </div>
                )}
                <div className="text-2xl font-bold">{c.title(candidate.id)}</div>
                <div className="mt-2 text-xl">
                  {candidate.name}, {candidate.degree} {candidate.university}. {decisionLine(candidate.draft)}
                </div>
                <div className="mt-1 text-lg text-slate-700">{c.note}</div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-erp-field={`confirm_${pending.action}`}
                    onClick={confirmAction}
                    disabled={confirmWaitMs > 0}
                    className={`rounded px-6 py-3 text-xl font-bold disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-white ${c.style}`}
                  >
                    {countdown > 0 ? `${c.confirm} (wait ${countdown} s)` : c.confirm}
                  </button>
                  <button type="button" onClick={cancelAction} className="rounded border-2 border-slate-900 bg-white px-6 py-3 text-xl font-semibold">
                    Cancel
                  </button>
                  {countdown > 0 && (
                    <span className="text-lg font-semibold text-orange-900">Read the tutor message first. You can confirm in {countdown} s.</span>
                  )}
                </div>
              </div>
            );
          })()}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Work history" field="work_history" highlight={highlight} open={showWork} onToggle={toggleWork}>
          <div
            className={`mb-3 rounded border-2 px-3 py-2 text-xl font-bold ${
              candidate.hasProductionMl ? "border-green-800 bg-green-100 text-green-900" : "border-slate-500 bg-slate-100 text-slate-900"
            }`}
          >
            {candidate.hasProductionMl
              ? `Production ML: yes, ${yearsLabel(candidate.productionMlYears)} at ${candidate.productionMlAt}`
              : "Production ML: none"}
          </div>
          <ul className="flex flex-col gap-3">
            {candidate.workHistory.map((w) => (
              <li key={`${w.period}-${w.title}`} className="border-b border-slate-300 pb-2">
                <div className="font-mono text-base text-slate-700">{w.period}</div>
                <div className="text-xl font-bold">{w.title}</div>
                <div className="text-lg font-semibold">{w.employer}</div>
                <div className="text-lg">{w.detail}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Education" field="education" highlight={highlight} open={showEducation} onToggle={toggleEducation}>
          <ul className="flex flex-col gap-3">
            {candidate.education.map((e) => (
              <li key={`${e.degree}-${e.years}`} className="border-b border-slate-300 pb-2">
                <div className="font-mono text-base text-slate-700">{e.years}</div>
                <div className="text-xl font-bold">
                  {e.degree} {e.field}
                </div>
                <div className="text-lg font-semibold">{e.university}</div>
                {e.detail && <div className="text-lg">{e.detail}</div>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Referral" field="referral" highlight={highlight} open={showReferral} onToggle={toggleReferral}>
          {candidate.referrer ? (
            <>
              <div className="text-xl font-bold">Referred by {candidate.referrer} (employee)</div>
              <div className="mt-1 text-lg">{candidate.referralNote}</div>
            </>
          ) : (
            <p className="text-xl font-semibold">No referral. Applied through the careers page.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
