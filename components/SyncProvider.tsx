"use client";

import { useEffect } from "react";
import { pull, push, pushBeacon, isDirty } from "@/lib/sync";

export default function SyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Pull remote data on mount
    pull();

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden" && isDirty()) {
        // Use sendBeacon — more reliable when tab is being hidden
        pushBeacon();
      }
    }

    function handleBeforeUnload() {
      if (isDirty()) {
        pushBeacon();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Periodic push every 30s as safety net
    const interval = setInterval(() => {
      if (isDirty()) push();
    }, 30_000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearInterval(interval);
    };
  }, []);

  return <>{children}</>;
}
