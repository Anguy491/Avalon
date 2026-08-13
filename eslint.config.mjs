import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.expo/**',
      '**/android/**',
      '**/coverage/**',
      '**/dist/**',
      '**/ios/**',
      '**/node_modules/**',
      'docs/contracts/*.schema.json',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    files: ['**/*.config.{js,mjs,ts}', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        exports: 'writable',
        fetch: 'readonly',
        process: 'readonly',
      },
      parserOptions: {
        projectService: false,
      },
    },
  },
);
