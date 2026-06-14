/**
 * Conventional-commit rules for the voz.gg monorepo.
 *
 * Scope is advisory: the recommended scope is a project name
 * (web, events-ingest, voz-gg-agent, mc-logparser, shared, go-shared),
 * but it is NOT enforced as an enum because nx release attributes version
 * bumps by changed files, not by the scope string.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
  },
};
