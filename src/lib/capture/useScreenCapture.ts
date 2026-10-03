"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenEvent } from "@/lib/types";
import { DEFAULT_GATE, gateTick, markSent, newGateState, THUMB_H, THUMB_W, toGray, type GateState } from "./diff";

export type CaptureStatus = "idle" | "requesting" | "sharing" | "error";

export type ScreenCapture = {
  start: () => Promise<void>;
  stop: () => void;
  status: CaptureStatus;
  error: string | null;
  events: ScreenEvent[];
  // Wall-clock ms (Date.now()) of the last on-screen change or ERP message.
  // Set by the local diff gate, before any upload or model call.
  lastActivityAt: number;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  // Pauses capture and deletes the last `seconds` (default 30) on the server.
  goOffRecord: (seconds?: number) => Promise<void>;
  framesSent: number;
};

const TICK_MS = 300;
const EVENT_POLL_MS = 3000;
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.7;
export const ERP_CHANNEL = "erp-events";
const EMPTY: ScreenEvent[] = [];

// A timer that keeps its rate while the tab is in the background (the expert
// works in another tab or window). Falls back to setInterval.
function startTicker(onTick: () => void): () => void {
  try {
    const src = `setInterval(() => postMessage(0), ${TICK_MS});`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = onTick;
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const h = setInterval(onTick, TICK_MS);
    return () => clearInterval(h);
  }
}

const isTypingPing = (e: { kind?: unknown; summary?: unknown }) =>
  e.kind === "other" && typeof e.summary === "string" && e.summary.trim().toLowerCase() === "typing";

export function useScreenCapture({ sessionId }: { sessionId: string | null | undefined }): ScreenCapture {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Events are tagged with their session so a session change starts from an empty list.
  const [eventStore, setEventStore] = useState<{ sessionId: string; list: ScreenEvent[] } | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState(0);
  const [paused, setPausedState] = useState(false);
  const [framesSent, setFramesSent] = useState(0);

  const sessionRef = useRef(sessionId);
  const startedAtRef = useRef<number | null>(null); // session start, wall-clock ms
  const pausedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopTickerRef = useRef<(() => void) | null>(null);
  const gateRef = useRef<GateState>(newGateState());
  const inFlightRef = useRef<AbortController | null>(null);
  const thumbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const addEvents = useCallback((id: string, incoming: ScreenEvent[]) => {
    if (!incoming.length) return;
    setEventStore((cur) => {
      const byId = new Map((cur?.sessionId === id ? cur.list : []).map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      return { sessionId: id, list: [...byId.values()].sort((a, b) => a.t - b.t) };
    });
  }, []);
  const events = eventStore && eventStore.sessionId === sessionId ? eventStore.list : EMPTY;

  const sessionNow = () => (startedAtRef.current === null ? null : Date.now() - startedAtRef.current);

  // Session change: load the start time and any events already stored.
  useEffect(() => {
    sessionRef.current = sessionId;
    startedAtRef.current = null;
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && s?.startedAt) startedAtRef.current = Date.parse(s.startedAt);
      })
      .catch(() => {}); // the server falls back to its own clock when `t` is missing
    // Stored events are also polled, so events written by another tab or
    // stored after a slow model call still show up.
    const pull = () =>
      fetch(`/api/sessions/${sessionId}/events`)
        .then((r) => (r.ok ? r.json() : []))
        .then((ev) => {
          if (!cancelled && !pausedRef.current && Array.isArray(ev)) addEvents(sessionId, ev);
        })
        .catch(() => {});
    void pull();
    const poll = setInterval(pull, EVENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [sessionId, addEvents]);

  // DOM events from the sandbox ERP, only while the screen is shared: nothing
  // is logged before the person has started sharing or after they stopped.
  // Every message counts as activity; real events are forwarded to the
  // server, typing pings are not stored.
  useEffect(() => {
    if (!sessionId || status !== "sharing" || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(ERP_CHANNEL);
    channel.onmessage = (msg: MessageEvent) => {
      setLastActivityAt(Date.now());
      const data = msg.data;
      if (!data || typeof data !== "object" || isTypingPing(data)) return;
      if (pausedRef.current) return; // nothing leaves the browser while paused
      fetch(`/api/sessions/${sessionId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallTime: Date.now(), ...data, source: "dom" }),
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((stored) => {
          if (Array.isArray(stored)) addEvents(sessionId, stored);
        })
        .catch(() => {});
    };
    return () => channel.close();
  }, [sessionId, status, addEvents]);

  const upload = useCallback(
    async (video: HTMLVideoElement) => {
      const id = sessionRef.current;
      if (!id) return;
      const controller = new AbortController();
      inFlightRef.current = controller;
      try {
        const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
        const canvas = (frameCanvasRef.current ??= document.createElement("canvas"));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        const t = sessionNow();
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
        // Pause or off the record may have happened while encoding.
        if (!blob || pausedRef.current || controller.signal.aborted) return;
        const res = await fetch(`/api/sessions/${id}/frames${t === null ? "" : `?t=${Math.round(t)}`}`, {
          method: "POST",
          headers: { "content-type": "image/jpeg" },
          body: blob,
          signal: controller.signal,
        });
        setFramesSent((n) => n + 1);
        if (res.ok && !pausedRef.current) {
          const stored = await res.json();
          if (Array.isArray(stored)) addEvents(id, stored);
        }
      } catch {
        // Aborted or network error: the next changed frame is sent as usual.
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null;
      }
    },
    [addEvents],
  );

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || pausedRef.current || video.readyState < 2 || !video.videoWidth) return;
    const canvas = (thumbCanvasRef.current ??= document.createElement("canvas"));
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const thumb = toGray(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data);
    const now = Date.now();
    const { activity, send } = gateTick(gateRef.current, thumb, now, DEFAULT_GATE);
    if (activity) setLastActivityAt(now);
    // One upload at a time. A frame that is due while one is in flight is not
    // queued: the next tick after it finishes sends the then-current screen.
    if (send && !inFlightRef.current) {
      markSent(gateRef.current, thumb, now);
      void upload(video);
    }
  }, [upload]);

  const stop = useCallback(() => {
    stopTickerRef.current?.();
    stopTickerRef.current = null;
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    videoRef.current = null;
    gateRef.current = newGateState();
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    if (!sessionRef.current) {
      setError("No session");
      setStatus("error");
      return;
    }
    setError(null);
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      streamRef.current = stream;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      videoRef.current = video;
      // The browser's own "Stop sharing" button ends the track.
      stream.getVideoTracks()[0]?.addEventListener("ended", stop);
      gateRef.current = newGateState();
      stopTickerRef.current = startTicker(tick);
      setStatus("sharing");
    } catch (err) {
      streamRef.current = null;
      setError(err instanceof Error ? err.message : "Screen sharing was not started");
      setStatus("error");
    }
  }, [stop, tick]);

  const setPaused = useCallback((value: boolean) => {
    pausedRef.current = value;
    setPausedState(value);
    if (value) {
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    } else {
      // Resume from a clean gate so the current screen is sent once.
      gateRef.current = newGateState();
    }
  }, []);

  const goOffRecord = useCallback(
    async (seconds = 30) => {
      setPaused(true);
      const id = sessionRef.current;
      if (!id) return;
      let toT = sessionNow();
      if (toT === null) {
        // Start time not loaded yet: ask the server.
        const s = await fetch(`/api/sessions/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!s?.startedAt) throw new Error("Could not go off the record: session not found");
        startedAtRef.current = Date.parse(s.startedAt);
        toT = Date.now() - startedAtRef.current;
      }
      const fromT = Math.max(0, toT - seconds * 1000);
      const end = toT;
      setEventStore((cur) => (cur ? { ...cur, list: cur.list.filter((e) => e.t < fromT || e.t > end) } : cur));
      const res = await fetch(`/api/sessions/${id}/offrecord`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromT, toT }),
      });
      if (!res.ok) throw new Error(`Could not go off the record (${res.status})`);
    },
    [setPaused],
  );

  // Release the screen when the component using the hook goes away.
  useEffect(() => stop, [stop]);

  return { start, stop, status, error, events, lastActivityAt, paused, setPaused, goOffRecord, framesSent };
}
