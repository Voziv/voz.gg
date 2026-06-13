import { describe, it, expect } from 'vitest';
import { parsePage, paginate } from './pagination';

describe('parsePage', () => {
  it('defaults to 1 for missing or invalid input', () => {
    expect(parsePage(null)).toBe(1);
    expect(parsePage('')).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-3')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage('2.5')).toBe(1);
  });
  it('parses a valid 1-based page', () => {
    expect(parsePage('1')).toBe(1);
    expect(parsePage('7')).toBe(7);
  });
});

describe('paginate', () => {
  it('computes offset and display range for a middle page', () => {
    const p = paginate(213, 2, 50);
    expect(p).toMatchObject({ page: 2, offset: 50, totalPages: 5, hasPrev: true, hasNext: true, from: 51, to: 100 });
  });

  it('clamps an over-range page to the last page', () => {
    const p = paginate(213, 99, 50);
    expect(p).toMatchObject({ page: 5, offset: 200, hasNext: false, from: 201, to: 213 });
  });

  it('handles an empty set as a single page with a zero range', () => {
    const p = paginate(0, 1, 50);
    expect(p).toMatchObject({ page: 1, totalPages: 1, hasPrev: false, hasNext: false, from: 0, to: 0 });
  });

  it('handles a single partial page', () => {
    const p = paginate(12, 1, 50);
    expect(p).toMatchObject({ totalPages: 1, hasNext: false, from: 1, to: 12 });
  });
});
