import { describe, it, expect } from 'vitest';
import { resolveOverallLatest, planMajorOffer, type OverallLatest } from './major-detect';
import type { Fetcher } from './types';

const NEO_XML = `<metadata><versioning><versions>
<version>26.1.0.5-beta</version><version>26.2.0.7-beta</version><version>27.0.0.1-beta</version>
</versions></versioning></metadata>`;
const neoFetch: Fetcher = async () => ({ ok: true, status: 200, async text() { return NEO_XML; }, async json() { return {}; } });

const FORGE_PROMOS = JSON.stringify({ promos: { '1.21.1-recommended': '52.0.10', '1.21.4-recommended': '54.1.0', '1.20.1-recommended': '47.3.0', '1.21.1-latest': '52.1.0', '1.21.6-latest': '56.0.1' } });
const forgeFetch: Fetcher = async () => ({ ok: true, status: 200, async text() { return FORGE_PROMOS; }, async json() { return JSON.parse(FORGE_PROMOS); } });

function fabricFetch(games: { version: string; stable: boolean }[], loaders: { version: string; stable: boolean }[]): Fetcher {
  return async (url) => {
    const body = url.includes('/versions/loader') ? loaders : games;
    return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
  };
}

describe('resolveOverallLatest', () => {
  it('neoforge returns the newest overall (ignoring any generation cap) with derived MC', async () => {
    const r = await resolveOverallLatest('neoforge', { source: 'neoforge', channel: 'beta' }, neoFetch);
    expect(r).toEqual({ version: '27.0.0.1-beta', mcVersion: '27.0', loaderVersion: '27.0.0.1-beta' });
  });
  it('forge picks the highest MC line for the channel', async () => {
    const r = await resolveOverallLatest('forge', { source: 'forge', channel: 'recommended' }, forgeFetch);
    expect(r).toEqual({ version: '1.21.4-54.1.0', mcVersion: '1.21.4', loaderVersion: '54.1.0' });
  });
  it('forge defaults an unset channel to latest (matching the in-line resolver)', async () => {
    const r = await resolveOverallLatest('forge', { source: 'forge', channel: null }, forgeFetch);
    expect(r).toEqual({ version: '1.21.6-56.0.1', mcVersion: '1.21.6', loaderVersion: '56.0.1' });
  });
  it('fabric picks the newest game version and resolves the latest loader', async () => {
    const fetch = fabricFetch(
      [{ version: '26.1', stable: true }, { version: '1.21.1', stable: true }],
      [{ version: '0.17.0', stable: true }],
    );
    const r = await resolveOverallLatest('fabric', { source: 'fabric', channel: null }, fetch);
    expect(r).toEqual({ version: '0.17.0', mcVersion: '26.1', loaderVersion: '0.17.0' });
  });
});

const overall27: OverallLatest = { version: '27.0.0.1-beta', mcVersion: '27.0', loaderVersion: '27.0.0.1-beta' };

describe('planMajorOffer', () => {
  it('none when the overall generation is not newer than installed', () => {
    expect(planMajorOffer({ majorPolicy: 'auto', installedMc: '27.0', overall: overall27, currentDesiredVersion: null, notifiedMajor: null }).kind).toBe('none');
  });
  it('auto policy yields an auto plan', () => {
    const p = planMajorOffer({ majorPolicy: 'auto', installedMc: '26.1', overall: overall27, currentDesiredVersion: null, notifiedMajor: null });
    expect(p).toEqual({ kind: 'auto', overall: overall27 });
  });
  it('auto is idempotent against the current desired version', () => {
    expect(planMajorOffer({ majorPolicy: 'auto', installedMc: '26.1', overall: overall27, currentDesiredVersion: '27.0.0.1-beta', notifiedMajor: null }).kind).toBe('none');
  });
  it('approve policy offers and flags notify on the first sighting', () => {
    const p = planMajorOffer({ majorPolicy: 'approve', installedMc: '26.1', overall: overall27, currentDesiredVersion: null, notifiedMajor: null });
    expect(p).toEqual({ kind: 'offer', overall: overall27, notify: true });
  });
  it('approve policy does not re-notify an already-notified major', () => {
    // notifiedMajor stores the generation (generationOf(overall.mcVersion)), not the
    // full mcVersion — for the year-based scheme that's just the year ('27', not '27.0').
    const p = planMajorOffer({ majorPolicy: 'approve', installedMc: '26.1', overall: overall27, currentDesiredVersion: null, notifiedMajor: '27' });
    expect(p).toEqual({ kind: 'offer', overall: overall27, notify: false });
  });
  it('notify policy behaves like offer (badge + notification, no auto-apply)', () => {
    const p = planMajorOffer({ majorPolicy: 'notify', installedMc: '26.1', overall: overall27, currentDesiredVersion: null, notifiedMajor: null });
    expect(p).toEqual({ kind: 'offer', overall: overall27, notify: true });
  });
});
