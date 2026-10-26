import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';

/**
 * The module boundaries below are the interesting part of this config.
 *
 * `libs/shared` is imported by the Angular bundle, so nothing with a Node dependency may be
 * reachable from it — `libs/db` (Drizzle, `pg`) and `libs/storage` (`node:fs`) in particular.
 * Expressed as tags, a mistake here is a lint failure rather than a bundle that breaks in the
 * browser at runtime.
 */
export default tseslint.config(
  { ignores: ['**/dist', '**/node_modules', '**/.nx', '**/*.timestamp*'] },
  ...tseslint.configs.recommended,
  {
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'platform:web',
              onlyDependOnLibsWithTags: ['platform:web', 'platform:agnostic'],
            },
            {
              sourceTag: 'platform:node',
              onlyDependOnLibsWithTags: ['platform:node', 'platform:agnostic'],
            },
            {
              sourceTag: 'platform:agnostic',
              onlyDependOnLibsWithTags: ['platform:agnostic'],
            },
            { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Generated and config files are not worth fighting over.
    files: ['**/jest.config.ts', '**/*.spec.ts', 'drizzle.config.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // The webpack configs Nx generates for the Nest apps are CommonJS by design.
    files: ['**/webpack.config.js', '**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
