/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
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
