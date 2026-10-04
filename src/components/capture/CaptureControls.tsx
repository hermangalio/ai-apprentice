"use client";

import type { ScreenCapture } from "@/lib/capture/useScreenCapture";

// Start/stop sharing, recording indicator and pause toggle.
export function CaptureControls({ capture }: { capture: ScreenCapture }) {
  const { status, paused, error } = capture;
  const sharing = status === "sharing";
  const recording = sharing && !paused;

  const label = recording
    ? "Recording and listening"
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
                : "border-stone-300 bg-stone-50 text-stone-600"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              recording ? "animate-pulse bg-red-600" : paused ? "bg-amber-500" : "bg-stone-400"
            }`}
          />
          {label}
        </span>

        {sharing ? (
          <button
            type="button"
            onClick={capture.stop}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-stone-800 hover:bg-stone-100"
          >
            Stop sharing
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void capture.start()}
            disabled={status === "requesting"}
            className="rounded-lg bg-indigo-600 px-3.5 py-1 font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Share screen and start
          </button>
        )}

        {sharing && (
        <button
          type="button"
          onClick={() => {
            capture.setPaused(!paused);
          }}
          aria-pressed={paused}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-stone-800 hover:bg-stone-100"
        >
          {paused ? "Resume" : "Pause"}
        </button>
        )}

      </div>
      {error && status === "error" && <p className="text-red-700">{error}</p>}
    </div>
  );
}

export default CaptureControls;
