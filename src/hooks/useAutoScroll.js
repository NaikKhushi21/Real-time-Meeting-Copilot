import { useEffect } from "react";

export function useAutoScroll(containerRef, dependency) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Keep auto-scroll only when user is already near the bottom.
    // This avoids jarring jumps if the user scrolls up to review context.
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 140) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth"
    });
  }, [containerRef, dependency]);
}
