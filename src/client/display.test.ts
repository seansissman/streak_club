import { describe, expect, it } from 'vitest';

import {
  deriveStreakDisplay,
  formatDays,
  formatDurationHms,
  formatLastCheckinDateTimeUtc,
  getEffectiveNowMs,
  getMsUntilNextCheckinDue,
  getMsUntilNextUtcMidnight,
} from './display';

const HOUR_MS = 3_600_000;

describe('client display helpers', () => {
  it('formats durations as zero-padded HH:MM:SS', () => {
    expect(formatDurationHms(0)).toBe('00:00:00');
    expect(formatDurationHms(65_000)).toBe('00:01:05');
    expect(formatDurationHms((25 * 3600 + 2 * 60 + 9) * 1000)).toBe('25:02:09');
  });

  it('formats singular and plural day labels', () => {
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(2)).toBe('2 days');
  });

  it('formats the last check-in timestamp in a stable UTC form', () => {
    expect(formatLastCheckinDateTimeUtc(null)).toBe('Never');
    expect(formatLastCheckinDateTimeUtc(0)).toBe('1970-01-01 00:00:00 UTC');
    expect(formatLastCheckinDateTimeUtc(20_500)).toBe('2026-02-16 00:00:00 UTC');
  });

  it('applies dev time offset seconds before countdown calculations', () => {
    const baseNowMs = Date.parse('2026-02-15T23:30:00.000Z');

    expect(getEffectiveNowMs(baseNowMs, null)).toBe(baseNowMs);
    expect(
      getEffectiveNowMs(baseNowMs, {
        devTimeOffsetSeconds: 3_600,
      })
    ).toBe(Date.parse('2026-02-16T00:30:00.000Z'));
  });

  it('returns the time until the next 00:00 UTC boundary', () => {
    const effectiveNowMs = Date.parse('2026-02-15T23:00:00.000Z');

    expect(getMsUntilNextUtcMidnight(effectiveNowMs)).toBe(HOUR_MS);
    expect(formatDurationHms(getMsUntilNextUtcMidnight(effectiveNowMs))).toBe(
      '01:00:00'
    );
  });

  it('keeps next check-in due distinct from the reset countdown', () => {
    const effectiveNowMs = Date.parse('2026-02-15T23:00:00.000Z');
    const lastCheckinDayUTC = Math.floor(effectiveNowMs / 86_400_000);

    const withoutFreeze = getMsUntilNextCheckinDue(
      {
        currentStreak: 4,
        lastCheckinDayUTC,
        freezeTokens: 0,
      },
      effectiveNowMs
    );
    const withFreeze = getMsUntilNextCheckinDue(
      {
        currentStreak: 4,
        lastCheckinDayUTC,
        freezeTokens: 1,
      },
      effectiveNowMs
    );

    expect(withoutFreeze).toBe(25 * HOUR_MS);
    expect(withFreeze).toBe(49 * HOUR_MS);
    expect(formatDurationHms(withoutFreeze ?? 0)).toBe('25:00:00');
    expect(formatDurationHms(withFreeze ?? 0)).toBe('49:00:00');
  });

  it('returns null next-checkin countdown when the user has not started a streak', () => {
    const effectiveNowMs = Date.parse('2026-02-15T23:00:00.000Z');

    expect(getMsUntilNextCheckinDue(null, effectiveNowMs)).toBeNull();
    expect(
      getMsUntilNextCheckinDue(
        {
          currentStreak: 0,
          lastCheckinDayUTC: null,
          freezeTokens: 0,
        },
        effectiveNowMs
      )
    ).toBeNull();
  });

  it('treats joined-but-not-yet-checked-in users as inactive with no active streak', () => {
    expect(
      deriveStreakDisplay(
        {
          currentStreak: 0,
          lastCheckinDayUTC: null,
          freezeTokens: 0,
        },
        20_500
      )
    ).toEqual({
      status: 'inactive',
      activeStreakDays: 0,
      storedStreakDays: 0,
      dayGap: null,
      note: 'No active streak yet.',
    });
  });

  it('preserves the stored streak while displaying an expired streak as inactive', () => {
    expect(
      deriveStreakDisplay(
        {
          currentStreak: 8,
          lastCheckinDayUTC: 20_500,
          freezeTokens: 0,
        },
        20_503
      )
    ).toEqual({
      status: 'inactive',
      activeStreakDays: 0,
      storedStreakDays: 8,
      dayGap: 3,
      note: 'Streak is inactive and will restart at 1 on your next check-in.',
    });
  });

  it('shows an at-risk streak for a one-day gap or a freeze-preservable two-day gap', () => {
    expect(
      deriveStreakDisplay(
        {
          currentStreak: 5,
          lastCheckinDayUTC: 20_500,
          freezeTokens: 0,
        },
        20_501
      )?.status
    ).toBe('at-risk');

    expect(
      deriveStreakDisplay(
        {
          currentStreak: 5,
          lastCheckinDayUTC: 20_500,
          freezeTokens: 1,
        },
        20_502
      )
    ).toEqual({
      status: 'at-risk',
      activeStreakDays: 5,
      storedStreakDays: 5,
      dayGap: 2,
      note: 'One freeze token can preserve this streak if you check in now.',
    });
  });
});
