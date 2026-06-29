import { describe, it, expect } from 'vitest';
import { deriveNeoforgeMcVersion, loaderInstallDescriptor, isLoaderSource } from './loader-install';

describe('deriveNeoforgeMcVersion', () => {
  it('maps major.minor.patch to the Minecraft line', () => {
    expect(deriveNeoforgeMcVersion('21.1.234')).toBe('1.21.1');
    expect(deriveNeoforgeMcVersion('20.4.80')).toBe('1.20.4');
  });
  it('drops a zero minor (MC had no patch)', () => {
    expect(deriveNeoforgeMcVersion('21.0.5')).toBe('1.21');
  });
});

describe('isLoaderSource', () => {
  it('accepts the three loaders and rejects others', () => {
    expect(isLoaderSource('neoforge')).toBe(true);
    expect(isLoaderSource('vanilla')).toBe(false);
    expect(isLoaderSource('modpack')).toBe(false);
  });
});

describe('loaderInstallDescriptor', () => {
  it('forge: splits the mc-build version string', () => {
    expect(loaderInstallDescriptor('forge', '1.21.1-52.1.14', '1.21.1')).toEqual({
      loader: 'forge', minecraftVersion: '1.21.1', loaderVersion: '52.1.14',
    });
  });
  it('neoforge: derives the mc line, loaderVersion is the full version', () => {
    expect(loaderInstallDescriptor('neoforge', '21.1.234', '21.1')).toEqual({
      loader: 'neoforge', minecraftVersion: '1.21.1', loaderVersion: '21.1.234',
    });
  });
  it('fabric: mc from versionLine, loaderVersion is the version', () => {
    expect(loaderInstallDescriptor('fabric', '0.16.9', '1.21.1')).toEqual({
      loader: 'fabric', minecraftVersion: '1.21.1', loaderVersion: '0.16.9',
    });
  });
  it('fabric: throws without a version line', () => {
    expect(() => loaderInstallDescriptor('fabric', '0.16.9', null)).toThrow(/version line/i);
  });
});
