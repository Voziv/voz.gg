import { describe, it, expect } from 'vitest';
import { deriveNeoforgeMcVersion } from './loader-install';
import { mcVersionOf, generationOf, compareDottedNumeric, isNewerGeneration, inLineResolverId } from './mc-version';

describe('deriveNeoforgeMcVersion (dual scheme)', () => {
  it('old scheme (<26) prepends 1. and drops a .0 patch', () => {
    expect(deriveNeoforgeMcVersion('20.2.59')).toBe('1.20.2');
    expect(deriveNeoforgeMcVersion('21.1.234')).toBe('1.21.1');
    expect(deriveNeoforgeMcVersion('21.0.5')).toBe('1.21');
  });
  it('new scheme (>=26) uses the version verbatim, dropping a .0 patch', () => {
    expect(deriveNeoforgeMcVersion('26.1.0.5-beta')).toBe('26.1');
    expect(deriveNeoforgeMcVersion('26.2.0.7-beta')).toBe('26.2');
    expect(deriveNeoforgeMcVersion('26.1.3.10')).toBe('26.1.3');
    expect(deriveNeoforgeMcVersion('27.0.0.1')).toBe('27.0');
  });
});

describe('mcVersionOf', () => {
  it('vanilla is identity', () => { expect(mcVersionOf('vanilla', '1.21.4', null)).toBe('1.21.4'); });
  it('forge is the part before the dash', () => { expect(mcVersionOf('forge', '1.21.1-52.0.10', null)).toBe('1.21.1'); });
  it('neoforge derives via the dual scheme', () => { expect(mcVersionOf('neoforge', '26.1.0.5-beta', null)).toBe('26.1'); });
  it('fabric uses the version line', () => { expect(mcVersionOf('fabric', '0.16.9', '1.21.1')).toBe('1.21.1'); });
  it('fabric without a line is null', () => { expect(mcVersionOf('fabric', '0.16.9', null)).toBeNull(); });
});

describe('generationOf', () => {
  it('old scheme uses the first two components', () => {
    expect(generationOf('1.21.4')).toBe('1.21');
    expect(generationOf('1.21')).toBe('1.21');
  });
  it('new scheme uses the year', () => {
    expect(generationOf('26.1')).toBe('26');
    expect(generationOf('26.2')).toBe('26');
    expect(generationOf('27.0')).toBe('27');
  });
  it('strips pre-release suffixes', () => { expect(generationOf('26.1-beta')).toBe('26'); });
  it('returns null for unparseable (snapshot) versions', () => { expect(generationOf('24w39a')).toBeNull(); });
});

describe('compareDottedNumeric', () => {
  it('orders within old scheme', () => { expect(compareDottedNumeric('1.21', '1.22')).toBe(-1); });
  it('orders the old->new transition (year beats 1.x)', () => { expect(compareDottedNumeric('26', '1.21')).toBe(1); });
  it('orders years', () => { expect(compareDottedNumeric('26', '27')).toBe(-1); });
  it('is numeric, not lexical', () => { expect(compareDottedNumeric('1.9', '1.21')).toBe(-1); });
  it('equal', () => { expect(compareDottedNumeric('26', '26')).toBe(0); });
});

describe('isNewerGeneration', () => {
  it('true when the second MC version is a newer generation', () => { expect(isNewerGeneration('26.1', '27.0')).toBe(true); });
  it('false within the same generation', () => { expect(isNewerGeneration('26.1', '26.2')).toBe(false); });
  it('false for an older generation', () => { expect(isNewerGeneration('26.1', '1.21')).toBe(false); });
  it('false when either is unparseable', () => { expect(isNewerGeneration('26.1', '24w39a')).toBe(false); });
});

describe('inLineResolverId', () => {
  it('vanilla caps to the installed generation', () => { expect(inLineResolverId('vanilla', '26.1', null, null)).toBe('26'); });
  it('vanilla old scheme', () => { expect(inLineResolverId('vanilla', '1.21.4', null, null)).toBe('1.21'); });
  it('neoforge uses the leading component of the installed version', () => { expect(inLineResolverId('neoforge', '26.1.0.5-beta', null, null)).toBe('26'); });
  it('neoforge old scheme leading component', () => { expect(inLineResolverId('neoforge', '21.1.234', null, null)).toBe('21'); });
  it('neoforge falls back to the version line when uninstalled', () => { expect(inLineResolverId('neoforge', null, '26.1', null)).toBe('26'); });
  it('forge uses the MC line from the installed version', () => { expect(inLineResolverId('forge', '1.21.1-52.0.10', '1.21.1', null)).toBe('1.21.1'); });
  it('forge falls back to the version line', () => { expect(inLineResolverId('forge', null, '1.21.1', null)).toBe('1.21.1'); });
  it('fabric uses the version line', () => { expect(inLineResolverId('fabric', '0.16.9', '1.21.1', null)).toBe('1.21.1'); });
  it('modpack uses the modpack id', () => { expect(inLineResolverId('modpack', null, null, 'pack-x')).toBe('pack-x'); });
});
