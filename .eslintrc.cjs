/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules', '*.cjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  overrides: [
    {
      // The simulation must stay portable: no DOM, no React, no renderer.
      // This is what lets src/sim be lifted into a headless server later.
      files: ['src/sim/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['@render/*', '@ui/*', '@game/*', '@net/*', 'react*'], message: 'src/sim must not depend on render, ui, game, net or React.' },
              { group: ['**/render/**', '**/ui/**'], message: 'src/sim must not depend on render or ui.' },
            ],
          },
        ],
        'no-restricted-globals': [
          'error',
          { name: 'window', message: 'src/sim must be DOM-free.' },
          { name: 'document', message: 'src/sim must be DOM-free.' },
          { name: 'performance', message: 'src/sim must be deterministic — derive time from ticks.' },
        ],
        'no-restricted-properties': [
          'error',
          { object: 'Math', property: 'random', message: 'Use the seeded PCG32 rng from @sim/math/rng.' },
          { object: 'Date', property: 'now', message: 'src/sim must be deterministic — derive time from ticks.' },
        ],
        'no-restricted-syntax': [
          'error',
          { selector: "NewExpression[callee.name='Date']", message: 'src/sim must be deterministic — derive time from ticks.' },
        ],
      },
    },
  ],
};
