// Configuración de ESLint para todo el monorepo (formato "flat config").
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import { moduleBoundaries } from './apps/api/eslint/module-boundaries.ts';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  // Reglas con información de tipos (solo TypeScript): detectan, p. ej., promesas sin await, algo
  // crítico en Express.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Fronteras del monolito modular: un módulo solo se importa desde fuera a través de su index.ts.
    files: ['apps/api/src/**/*.ts'],
    plugins: { local: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: {
      'local/module-boundaries': 'error',
      // Los valores no adivinables se generan con node:crypto (ASVS 11.5.1).
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Usa node:crypto (CSPRNG).' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React escapa el texto; insertar HTML a mano abre la puerta a XSS (ASVS 3.2.2).
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No insertes HTML sin escapar.',
        },
        {
          // Mismo riesgo sin JSX: createElement(..., { dangerouslySetInnerHTML }) o un objeto de props.
          selector:
            "Property[key.name='dangerouslySetInnerHTML'], Property[key.value='dangerouslySetInnerHTML']",
          message: 'No insertes HTML sin escapar.',
        },
        {
          // Las mismas inyecciones por el DOM directo (ASVS 1.1.2, 1.2.1).
          selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
          message: 'No insertes HTML sin escapar: usa textContent o JSX.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]',
          message: 'No insertes HTML sin escapar.',
        },
      ],
    },
  },
  {
    // Archivos de configuración en JavaScript: sin comprobación de tipos.
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
