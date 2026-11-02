import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { moduleBoundaries } from '../eslint/module-boundaries.ts';

// RuleTester usa describe/it globales; se conectan con los de Vitest.
RuleTester.describe = describe;
RuleTester.it = it;

const src = path.join(path.sep, 'repo', 'apps', 'api', 'src');
const file = (...parts: string[]): string => path.join(src, ...parts);
const ruleTester = new RuleTester();

ruleTester.run('module-boundaries', moduleBoundaries, {
  valid: [
    {
      filename: file('modules', 'auth', 'auth.service.ts'),
      code: "import { x } from './auth.repository.ts';",
    },
    {
      filename: file('modules', 'finance', 'ledger', 'a.ts'),
      code: "import { x } from '../plan/b.ts';",
    },
    {
      filename: file('modules', 'imports', 'imports.service.ts'),
      code: "import { x } from '../finance/index.ts';",
    },
    { filename: file('container.ts'), code: "import { x } from './modules/auth/index.ts';" },
    {
      filename: file('modules', 'auth', 'a.ts'),
      code: "import { x } from '../../http/errors.ts';",
    },
    { filename: file('modules', 'auth', 'a.ts'), code: "import { z } from 'zod';" },
  ],
  invalid: [
    {
      filename: file('modules', 'imports', 'imports.service.ts'),
      code: "import { x } from '../finance/ledger/movements.repository.ts';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      filename: file('container.ts'),
      code: "export { x } from './modules/auth/auth.repository.ts';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      filename: file('jobs', 'scheduler.ts'),
      code: "const m = await import('../modules/tasks/tasks.service.ts');",
      errors: [{ messageId: 'deepImport' }],
    },
  ],
});
