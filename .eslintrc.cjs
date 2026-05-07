/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  env: { browser: true, node: true, es2022: true },
  settings: {
    'import/resolver': {
      typescript: { alwaysTryTypes: true, project: ['shared/tsconfig.json', 'server/tsconfig.json', 'client/tsconfig.json'] },
      node: true,
    },
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'warn',
    'import/order': ['warn', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
    'import/no-unresolved': 'off',
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['client/**/*.{ts,tsx}'],
      plugins: ['react-hooks', 'react-refresh'],
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
  ],
  ignorePatterns: ['dist', 'build', 'coverage', 'node_modules'],
};
