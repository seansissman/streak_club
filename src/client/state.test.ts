import { describe, expect, it } from 'vitest';

import { shouldRenderCheckInButton } from './state';

describe('client check-in rendering state', () => {
  it('does not render check-in button when checkedInToday is true', () => {
    const me = {
      state: {
        lastCheckinDayUTC: 20500,
      },
      checkedInToday: true,
    };

    const result = shouldRenderCheckInButton(me, { effectiveDayNumber: 20500 });
    expect(result).toBe(false);
  });

  it('does not render check-in button when API marks effective day as non-checkin', () => {
    const me = {
      state: {
        lastCheckinDayUTC: 20500,
      },
      checkedInToday: false,
      canCheckInToday: false,
    };

    const result = shouldRenderCheckInButton(me, { effectiveDayNumber: 20490 });
    expect(result).toBe(false);
  });
});
