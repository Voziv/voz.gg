import { evaluateUpdateNotification } from './evaluate';

const base = { available: '1.21.4', current: '1.21.1', pinned: null, notified: null };

describe('evaluateUpdateNotification', () => {
  it('notifies when available differs from current and was not notified', () => {
    expect(evaluateUpdateNotification(base).shouldNotify).toBe(true);
  });
  it('does not notify when available equals current', () => {
    expect(evaluateUpdateNotification({ ...base, available: '1.21.1' }).shouldNotify).toBe(false);
  });
  it('does not notify when already notified for that version', () => {
    expect(evaluateUpdateNotification({ ...base, notified: '1.21.4' }).shouldNotify).toBe(false);
  });
  it('does not notify when available is at or below the pin', () => {
    expect(evaluateUpdateNotification({ ...base, pinned: '1.21.4' }).shouldNotify).toBe(false);
  });
  it('notifies once when current is unset', () => {
    expect(evaluateUpdateNotification({ ...base, current: null }).shouldNotify).toBe(true);
  });
  it('does not notify when available is null', () => {
    expect(evaluateUpdateNotification({ ...base, available: null }).shouldNotify).toBe(false);
  });
});
