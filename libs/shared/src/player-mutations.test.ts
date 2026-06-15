import { describe, it, expect } from 'vitest';
import {
  parsePlayerFieldsInput,
  normalizeGroupName,
  computeMergeResult,
  type PlayerCore,
} from './player-mutations';

const core = (over: Partial<PlayerCore> = {}): PlayerCore => ({
  id: 'p1',
  displayName: null,
  notes: null,
  status: 'new',
  isBot: false,
  userId: null,
  ...over,
});

describe('parsePlayerFieldsInput', () => {
  it('accepts a valid partial update', () => {
    const r = parsePlayerFieldsInput({ status: 'allowed', isBot: true });
    expect(r).toEqual({ ok: true, data: { status: 'allowed', isBot: true } });
  });

  it('trims displayName and treats blank as null', () => {
    const r = parsePlayerFieldsInput({ displayName: '  ' });
    expect(r).toEqual({ ok: true, data: { displayName: null } });
  });

  it('rejects an unknown status', () => {
    const r = parsePlayerFieldsInput({ status: 'banned' });
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown field', () => {
    const r = parsePlayerFieldsInput({ role: 'admin' });
    expect(r.ok).toBe(false);
  });

  it('rejects an empty body (no fields)', () => {
    const r = parsePlayerFieldsInput({});
    expect(r.ok).toBe(false);
  });
});

describe('normalizeGroupName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeGroupName('  WTK   crew ')).toBe('WTK crew');
  });
  it('returns null for blank', () => {
    expect(normalizeGroupName('   ')).toBeNull();
  });
});

describe('computeMergeResult', () => {
  it('ORs isBot, appends notes, carries the single account link', () => {
    const r = computeMergeResult(
      core({ notes: 'survivor note', isBot: false, userId: 'u1' }),
      core({ id: 'p2', notes: 'absorbed note', isBot: true, userId: null }),
    );
    expect(r).toEqual({
      ok: true,
      combine: { notes: 'survivor note\n\nabsorbed note', isBot: true, userId: 'u1' },
    });
  });

  it('carries the absorbed account link when the survivor has none', () => {
    const r = computeMergeResult(core({ userId: null }), core({ id: 'p2', userId: 'u2' }));
    expect(r.ok && r.combine.userId).toBe('u2');
  });

  it('rejects when both sides have distinct accounts', () => {
    const r = computeMergeResult(core({ userId: 'u1' }), core({ id: 'p2', userId: 'u2' }));
    expect(r).toEqual({ ok: false, reason: 'account-conflict' });
  });

  it('is a no-op-link when both have the same account', () => {
    const r = computeMergeResult(core({ userId: 'u1' }), core({ id: 'p2', userId: 'u1' }));
    expect(r.ok && r.combine.userId).toBe('u1');
  });
});
