import type { ModpackProvider, UpdateSource } from '../schema';
import type { VersionResolver } from './types';
import { vanillaResolver } from './resolvers/vanilla';
import { forgeResolver } from './resolvers/forge';
import { neoforgeResolver } from './resolvers/neoforge';
import { fabricResolver } from './resolvers/fabric';
import { modrinthResolver } from './resolvers/modrinth';
import { ftbResolver } from './resolvers/ftb';
import { packwizResolver } from './resolvers/packwiz';
import { curseforgeResolver } from './resolvers/curseforge';

const SOURCE_RESOLVERS: Partial<Record<UpdateSource, VersionResolver>> = {
  vanilla: vanillaResolver,
  forge: forgeResolver,
  neoforge: neoforgeResolver,
  fabric: fabricResolver,
};

const PROVIDER_RESOLVERS: Record<ModpackProvider, VersionResolver> = {
  modrinth: modrinthResolver,
  ftb: ftbResolver,
  packwiz: packwizResolver,
  curseforge: curseforgeResolver,
};

export function resolverFor(source: UpdateSource, provider?: ModpackProvider | null): VersionResolver | null {
  if (source === 'modpack') return provider ? (PROVIDER_RESOLVERS[provider] ?? null) : null;
  return SOURCE_RESOLVERS[source] ?? null;
}
