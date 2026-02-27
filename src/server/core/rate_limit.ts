export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
};

export const ACTION_THROTTLE_WINDOW_MS = 2_000;

export const evaluateActionThrottle = (
  nowMs: number,
  lastAttemptMs: number | null,
  windowMs: number = ACTION_THROTTLE_WINDOW_MS
): RateLimitDecision => {
  if (lastAttemptMs === null) {
    return { allowed: true, retryAfterMs: 0 };
  }

  if (lastAttemptMs > nowMs) {
    // Self-heal path for clock/offset jumps: allow and let caller overwrite with nowMs.
    return { allowed: true, retryAfterMs: 0 };
  }

  const elapsedMs = nowMs - lastAttemptMs;
  if (elapsedMs >= windowMs) {
    return { allowed: true, retryAfterMs: 0 };
  }

  return {
    allowed: false,
    retryAfterMs: Math.max(windowMs - elapsedMs, 0),
  };
};
