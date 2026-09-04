// ESLint flat config for the library sources (`npm run lint` → `src/**/*.{ts,tsx}`).
//
// Scope is deliberately narrow: TypeScript correctness rules plus the two React
// hooks rules that matter for a hooks-based library. The example app and the
// snippet files under `examples/` have their own dependency trees and are
// excluded; `harness/` is gitignored diagnostic tooling.
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  globalIgnores(['lib/**', 'node_modules/**', 'example_app/**', 'examples/**', 'harness/**']),

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // `noUnusedLocals` / `noUnusedParameters` in tsconfig already catch most
      // of this; keep the rule for `catch` bindings and destructured leftovers,
      // and allow the `_`-prefix convention for intentionally unused names.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Type-only imports must be `import type` so the Babel build (which
      // strips types without type information) never emits a runtime import
      // for something that doesn't exist at runtime.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // Forward-compat idiom `Known | (string & {})` keeps autocomplete for the
      // known literals while accepting any string; `{}` is intentional there.
      '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: 'always' }],
    },
  },

  {
    files: ['src/__tests__/**/*.ts', 'src/__mocks__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]);
