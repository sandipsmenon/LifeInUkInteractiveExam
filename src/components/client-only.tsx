"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};

/** True only in the browser after hydration; avoids server/client mismatches for random or time-based UI. */
export function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useMounted() ? children : fallback;
}
