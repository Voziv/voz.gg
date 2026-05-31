#!/usr/bin/env node
/**
 * Programmatic nx release runner.
 *
 * nx release's conventionalCommits versioning bumps package.json for JS
 * projects but has no manifest to write for Go projects. This script runs
 * releaseVersion to compute per-project versions, writes the computed version
 * into each Go project's VERSION file, then runs releaseChangelog so the
 * VERSION change, changelog, commit, and tag all land together.
 *
 * Go projects are identified as projects with a VERSION file and no
 * package.json at their root.
 *
 * Usage:
 *   node tools/release/release.mjs            # real release
 *   node tools/release/release.mjs --dry-run  # compute + preview, no writes/tags
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectGraphAsync } from '@nx/devkit';
import { releaseChangelog, releaseVersion } from 'nx/release';

const dryRun = process.argv.includes('--dry-run');

async function run() {
  const graph = await createProjectGraphAsync({ exitOnError: true });

  const { workspaceVersion, projectsVersionData } = await releaseVersion({
    dryRun,
    verbose: true,
  });

  for (const [projectName, data] of Object.entries(projectsVersionData)) {
    const newVersion = data?.newVersion;
    if (!newVersion) {
      continue; // no releasable commits for this project
    }
    const root = graph.nodes[projectName]?.data?.root;
    if (!root) {
      continue;
    }
    const versionFile = join(root, 'VERSION');
    const hasVersionFile = existsSync(versionFile);
    const hasPackageJson = existsSync(join(root, 'package.json'));
    if (hasVersionFile && !hasPackageJson) {
      if (dryRun) {
        console.log(`[dry-run] would write ${newVersion} to ${versionFile}`);
      } else {
        writeFileSync(versionFile, `${newVersion}\n`);
        console.log(`wrote ${newVersion} to ${versionFile}`);
      }
    }
  }

  await releaseChangelog({
    dryRun,
    verbose: true,
    versionData: projectsVersionData,
    version: workspaceVersion,
  });

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
