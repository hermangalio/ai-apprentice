// Diff gate helpers. Pure functions so they can be tested without a browser.

export const THUMB_W = 160;
export const THUMB_H = 90;

// RGBA pixels to one luminance byte per pixel.
export function toGray(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

// Number of thumbnail cells whose brightness differs by more than `level`.
export function changedCells(a: Uint8Array, b: Uint8Array, level = 10): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    if (d > level || d < -level) n++;
  }
  return n;
}

export type GateState = {
  prev: Uint8Array | null; // thumbnail from the previous tick
  lastSent: Uint8Array | null; // thumbnail of the last uploaded frame
  lastChangeAt: number; // last tick on which the screen was seen changing
  dirtySince: number | null; // since when the screen differs from lastSent
  lastSentAt: number;
};

export const newGateState = (): GateState => ({
  prev: null,
  lastSent: null,
  lastChangeAt: 0,
  dirtySince: null,
  lastSentAt: 0,
});

export type GateOptions = {
  minCells: number; // cells that must differ to count as change
  stableMs: number; // send once the screen has been still this long
  maxWaitMs: number; // or after this much continuous change
  minIntervalMs: number; // never send more often than this
};

export const DEFAULT_GATE: GateOptions = { minCells: 2, stableMs: 600, maxWaitMs: 3000, minIntervalMs: 1500 };

// One tick of the gate. `activity` is true when the screen changed since the
// previous tick; `send` is true when the current frame should be uploaded
// (the caller still has to check that no upload is in flight, and call
// markSent when it does send).
export function gateTick(
  s: GateState,
  thumb: Uint8Array,
  now: number,
  o: GateOptions = DEFAULT_GATE,
): { activity: boolean; send: boolean } {
  const activity = s.prev !== null && changedCells(s.prev, thumb) >= o.minCells;
  if (activity) s.lastChangeAt = now;
  s.prev = thumb;

  const dirty = s.lastSent === null || changedCells(s.lastSent, thumb) >= o.minCells;
  if (!dirty) {
    s.dirtySince = null;
    return { activity, send: false };
  }
  s.dirtySince ??= now;
  const stable = now - s.lastChangeAt >= o.stableMs;
  const overdue = now - s.dirtySince >= o.maxWaitMs;
  const send = (stable || overdue) && now - s.lastSentAt >= o.minIntervalMs;
  return { activity, send };
}

export function markSent(s: GateState, thumb: Uint8Array, now: number) {
  s.lastSent = thumb;
  s.lastSentAt = now;
  s.dirtySince = null;
}
