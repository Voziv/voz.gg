import { describe, it, expect } from 'vitest';
import { localHmToUtc, utcHmToLocal } from './restart-time';

// getTimezoneOffset() returns minutes to ADD to local to reach UTC:
// US Eastern Standard = +300, a UTC+10 zone = -600.
describe('localHmToUtc', () => {
  it('is identity at offset 0', () => {
    expect(localHmToUtc('08:00', 0)).toBe('08:00');
  });
  it('converts local to UTC for a +300 (EST) offset', () => {
    expect(localHmToUtc('22:00', 300)).toBe('03:00'); // 22:00 + 5h = 03:00 next day
  });
  it('wraps past midnight downward for a -600 offset', () => {
    expect(localHmToUtc('05:00', -600)).toBe('19:00'); // 05:00 - 10h = 19:00 prev day
  });
});

describe('utcHmToLocal', () => {
  it('round-trips with localHmToUtc', () => {
    expect(utcHmToLocal(localHmToUtc('22:00', 300), 300)).toBe('22:00');
    expect(utcHmToLocal(localHmToUtc('05:00', -600), -600)).toBe('05:00');
  });
});
