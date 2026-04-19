/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  // We rely on `tsc --noEmit` in the `typecheck` script for type correctness. The
  // type-aware ESLint ruleset (`recommended-type-checked`) was previously enabled
  // but emitted a per-file warning on any route handler that Next lints without a
  // tsconfig in scope. Dropping it silences the warning without losing coverage —
  // there is no rule in that set that isn't already covered by `tsc`.
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']:not(:has(+ CallExpression[callee.object.type='Identifier']))",
        message: 'Prefer Zod schema.parse() over JSON.parse at trust boundaries.',
      },
    ],
  },
  ignorePatterns: ['dist', '.next', 'out', 'node_modules', 'target', '*.node', 'coverage', '*.cjs'],
};
