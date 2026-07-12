export type LoaderSource = 'forge' | 'neoforge' | 'fabric';

export interface InstallDescriptor {
  loader: LoaderSource;
  minecraftVersion: string;
  loaderVersion: string;
}

export function isLoaderSource(source: string): source is LoaderSource {
  return source === 'forge' || source === 'neoforge' || source === 'fabric';
}

export const NEOFORGE_YEAR_SCHEME_MIN = 26;

// NeoForge switched from <mcMinor>.<mcPatch>.<build> (old scheme, implicitly
// MC 1.x) to a year-based scheme where the version *is* the Minecraft version
// (<mcYear>.<mcMinor>.<mcPatch>.<build>), once the leading component reaches
// NEOFORGE_YEAR_SCHEME_MIN.
export function deriveNeoforgeMcVersion(neoforgeVersion: string): string {
  const core = neoforgeVersion.split('-')[0];
  const [a, b, c] = core.split('.');
  const major = Number(a);
  if (!a || b === undefined || Number.isNaN(major)) {
    throw new Error(`unrecognized neoforge version: ${neoforgeVersion}`);
  }
  if (major >= NEOFORGE_YEAR_SCHEME_MIN) {
    // Year-based scheme: a.b.c = Minecraft major.minor.patch; the trailing group is the build.
    return c && c !== '0' ? `${a}.${b}.${c}` : `${a}.${b}`;
  }
  // Old scheme: a = Minecraft minor, b = Minecraft patch (0 omitted); prefixed with 1.
  return b === '0' ? `1.${a}` : `1.${a}.${b}`;
}

export function loaderInstallDescriptor(
  source: LoaderSource,
  version: string,
  versionLine: string | null,
): InstallDescriptor {
  switch (source) {
    case 'forge': {
      const dash = version.indexOf('-');
      if (dash < 0) throw new Error(`unrecognized forge version: ${version}`);
      return {
        loader: 'forge',
        minecraftVersion: version.slice(0, dash),
        loaderVersion: version.slice(dash + 1),
      };
    }
    case 'neoforge':
      return { loader: 'neoforge', minecraftVersion: deriveNeoforgeMcVersion(version), loaderVersion: version };
    case 'fabric': {
      const mc = versionLine?.trim();
      if (!mc) throw new Error('fabric apply requires a Minecraft version line');
      return { loader: 'fabric', minecraftVersion: mc, loaderVersion: version };
    }
  }
}
