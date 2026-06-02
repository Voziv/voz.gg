import { describe, it, expect } from 'vitest';
import { parseInviteRequestInput, normalizeEmail } from './invite-schema';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('parseInviteRequestInput', () => {
  it('accepts valid input and lowercases the email', () => {
    const r = parseInviteRequestInput({ name: 'Ada', discordName: 'ada#1', email: 'Ada@Example.com' });
    expect(r).toEqual({ ok: true, data: { name: 'Ada', discordName: 'ada#1', email: 'ada@example.com' } });
  });

  it('rejects a missing name', () => {
    const r = parseInviteRequestInput({ name: '', discordName: 'ada', email: 'a@b.co' });
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid email', () => {
    const r = parseInviteRequestInput({ name: 'Ada', discordName: 'ada', email: 'not-an-email' });
    expect(r.ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(parseInviteRequestInput(null).ok).toBe(false);
  });
});
