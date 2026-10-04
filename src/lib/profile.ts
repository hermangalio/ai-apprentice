"use client";

import { useSyncExternalStore } from "react";

// Who is using the app. There is no sign-in, so the name the expert types on
// the capture screen is remembered in this browser and shown in the top bar.

const KEY = "apprentice.personName";
const EVENT = "apprentice:profile";
export const DEFAULT_PERSON_NAME = "Jamie Davis";

export function readPersonName(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_PERSON_NAME;
  } catch {
    return DEFAULT_PERSON_NAME; // private window, blocked storage
  }
}

export function writePersonName(name: string) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Not fatal: the name is still held in the page's own state.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Null on the server and while hydrating, so the first client render matches
// the markup React received. The stored name arrives right after.
export function usePersonName(): string | null {
  return useSyncExternalStore(subscribe, readPersonName, () => null);
}
