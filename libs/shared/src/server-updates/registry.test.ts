import { describe, it, expect } from 'vitest';
import { resolverFor } from './registry';
import { vanillaResolver } from './resolvers/vanilla';
import { modrinthResolver } from './resolvers/modrinth';

describe('resolverFor', () => {
  it('maps a loader source to its resolver', () => {
    expect(resolverFor('vanilla')).toBe(vanillaResolver);
  });
  it('maps a modpack provider to its resolver', () => {
    expect(resolverFor('modpack', 'modrinth')).toBe(modrinthResolver);
  });
  it('returns null for none', () => {
    expect(resolverFor('none')).toBeNull();
  });
  it('returns null for a modpack with no provider', () => {
    expect(resolverFor('modpack', null)).toBeNull();
  });
});
