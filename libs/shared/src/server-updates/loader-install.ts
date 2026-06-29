export type LoaderSource = 'forge' | 'neoforge' | 'fabric';

export interface InstallDescriptor {
  loader: LoaderSource;
  minecraftVersion: string;
  loaderVersion: string;
}

export function isLoaderSource(source: string): source is LoaderSource {
  return source === 'forge' || source === 'neoforge' || source === 'fabric';
}

// NeoForge versions are <mcMajor>.<mcMinor>.<patch>; the Minecraft line is
// 1.<mcMajor>.<mcMinor>, collapsing a zero minor to 1.<mcMajor> (e.g. MC 1.21).
export function deriveNeoforgeMcVersion(neoforgeVersion: string): string {
  const [major, minor] = neoforgeVersion.split('.');
  if (!major || minor === undefined) {
    throw new Error(`unrecognized neoforge version: ${neoforgeVersion}`);
  }
  return minor === '0' ? `1.${major}` : `1.${major}.${minor}`;
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
