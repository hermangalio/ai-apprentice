"use client";

import { useState } from "react";
import type { ScreenCapture } from "@/lib/capture/useScreenCapture";

// Start/stop sharing, recording indicator, pause toggle and "Off the record".
export function CaptureControls({ capture, offRecordSeconds = 30 }: { capture: ScreenCapture; offRecordSeconds?: number }) {
  const { status, paused, error } = capture;
  const sharing = status === "sharing";
  const recording = sharing && !paused;
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const offRecord = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await capture.goOffRecord(offRecordSeconds);
      setNotice(`Last ${offRecordSeconds} s deleted. Capture is paused.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Off the record failed");
    } finally {
      setBusy(false);
    }
  };

  const label = recording
    ? "Recording"
    : paused
      ? "Paused, nothing is sent"
      : status === "requesting"
        ? "Waiting for screen selection"
        : "Not recording";

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${
            recording
              ? "border-red-300 bg-red-50 text-red-700"
              : paused
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-zinc-300 bg-zinc-50 text-zinc-600"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              recording ? "animate-pulse bg-red-600" : paused ? "bg-amber-500" : "bg-zinc-400"
            }`}
          />
          {label}
        </span>

        {sharing ? (
          <button
            type="button"
            onClick={capture.stop}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-zinc-800 hover:bg-zinc-100"
          >
            Stop sharing
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void capture.start()}
            disabled={status === "requesting"}
            className="rounded bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            Share screen
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setNotice(null);
            capture.setPaused(!paused);
          }}
          aria-pressed={paused}
          className="rounded border border-zinc-300 bg-white px-3 py-1 text-zinc-800 hover:bg-zinc-100"
        >
          {paused ? "Resume" : "Pause"}
        </button>

        <button
          type="button"
          onClick={() => void offRecord()}
          disabled={busy}
          title={`Pause and delete the last ${offRecordSeconds} seconds of frames, events and transcript`}
          className="rounded border border-amber-400 bg-amber-50 px-3 py-1 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          Off the record
        </button>
      </div>
      {notice && <p className="text-amber-800">{notice}</p>}
      {error && status === "error" && <p className="text-red-700">{error}</p>}
    </div>
  );
}

export default CaptureControls;
