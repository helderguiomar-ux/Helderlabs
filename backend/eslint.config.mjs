import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': typescriptEslint
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              importNames: ['PrismaClient'],
              message: 'IMPORTAR PrismaClient DIRETO É PROIBIDO para evitar fuga de dados entre tenants. Utilize sempre `forTenant(tenantId)` de `src/database/prisma/tenantScopedClient.ts`.'
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      'src/database/prisma/client.ts',
      'src/database/prisma/tenantScopedClient.ts'
    ],
    rules: {
      'no-restricted-imports': 'off'
    }
  }
];
