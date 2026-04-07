"use client";

import { useEffect, useRef } from "react";

function idleMsFromEnv(): number {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_IDLE_MINUTES;
  const n = raw ? parseInt(raw, 10) : NaN;
  const minutes = Number.isFinite(n) ? Math.max(5, Math.min(n, 24 * 60)) : 30;
  return minutes * 60 * 1000;
}

/**
 * Po nečinnosti zmaže session cookie a presmeruje na /login (ak nie si už tam).
 * Aktivita sa throttleuje, aby scroll nebil timer príliš často.
 */
export default function IdleSessionGuard() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastThrottleRef = useRef(0);

  useEffect(() => {
    const idleMs = idleMsFromEnv();

    function clearTimer() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function onIdle() {
      clearTimer();
      void (async () => {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include",
          });
        } catch {
          /* ignore */
        }
        if (
          typeof window !== "undefined" &&
          !window.location.pathname.startsWith("/login")
        ) {
          window.location.href = "/login?reason=idle";
        }
      })();
    }

    function scheduleIdle() {
      clearTimer();
      timerRef.current = setTimeout(onIdle, idleMs);
    }

    function onActivity() {
      const now = Date.now();
      if (now - lastThrottleRef.current < 5000) return;
      lastThrottleRef.current = now;
      scheduleIdle();
    }

    const events: (keyof WindowEventMap)[] = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    events.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true })
    );
    scheduleIdle();

    return () => {
      clearTimer();
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
    };
  }, []);

  return null;
}
