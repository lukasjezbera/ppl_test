"use client";

import { useEffect } from "react";
import { pull, push, isDirty } from "@/lib/sync";

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
        push();
      }
    }

    function handleBeforeUnload() {
      if (isDirty()) {
        // Use sendBeacon-style sync via navigator if available
        const data = localStorage.getItem("ppl-quiz-scores");
        if (data && navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/sync",
            new Blob([data], { type: "application/json" })
          );
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return <>{children}</>;
}
