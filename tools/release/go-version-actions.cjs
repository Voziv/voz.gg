/**
 * nx release version actions for Go projects.
 *
 * Go projects have no package.json for nx release to bump, so their version
 * lives in a plain `VERSION` file at the project root. That value is embedded
 * into the compiled binary at build time via `-ldflags "-X main.version=..."`
 * and surfaced through a `--version` flag.
 *
 * Wired up per Go project via `release.version.versionActions` in project.json;
 * TS projects keep using the default @nx/js (package.json) actions.
 *
 * Loaded by nx via `require()`, so this is CommonJS (the workspace is ESM, so a
 * `.cjs` extension is required for require() to treat it as CommonJS).
 */
const { join } = require('node:path');
const { VersionActions } = require('nx/release');

class GoVersionActions extends VersionActions {
  validManifestFilenames = ['VERSION'];

  manifestPath() {
    return join(this.projectGraphNode.data.root, 'VERSION');
  }

  async readCurrentVersionFromSourceManifest(tree) {
    const manifestPath = this.manifestPath();
    const contents = tree.read(manifestPath, 'utf-8');
    if (contents === null) {
      return null;
    }
    return { currentVersion: contents.trim(), manifestPath };
  }

  async readCurrentVersionFromRegistry() {
    // Go projects are not published to a package registry.
    return null;
  }

  async readCurrentVersionOfDependency() {
    // Inter-project Go dependencies resolve through the single root go.mod by
    // import path, not per-project version ranges, so there is nothing to read.
    return { currentVersion: null, dependencyCollection: null };
  }

  async updateProjectVersion(tree, newVersion) {
    const manifestPath = this.manifestPath();
    tree.write(manifestPath, `${newVersion}\n`);
    return [`Updated ${manifestPath} to ${newVersion}`];
  }

  async updateProjectDependencies() {
    // No per-project dependency manifest to rewrite (see readCurrentVersionOfDependency).
    return [];
  }
}

module.exports = GoVersionActions;
