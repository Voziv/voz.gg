import { describe, it, expect } from 'vitest';
import { chunk } from './chunk';

describe('chunk', () => {
  it('returns empty array for empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('returns one chunk when items fewer than size', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('returns one chunk when items exactly equal size', () => {
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('returns two chunks when items are size+1', () => {
    expect(chunk([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [4]]);
  });

  it('splits 1000 items into 10 chunks of 100', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const result = chunk(items, 100);
    expect(result).toHaveLength(10);
    for (const group of result) {
      expect(group).toHaveLength(100);
    }
  });
});
