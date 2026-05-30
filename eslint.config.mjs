import nx from '@nx/eslint-plugin';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/worker-configuration.d.ts',
    ],
  },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          depConstraints: [
            { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:service', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:tool', onlyDependOnLibsWithTags: ['type:lib'] },
          ],
        },
      ],
    },
  },
];
