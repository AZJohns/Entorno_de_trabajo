import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  deepImportTarget,
  moduleBoundaries,
  moduleOf,
  toPosixPath,
} from '../eslint/module-boundaries.ts';

// RuleTester usa describe/it globales; se conectan con los de Vitest.
RuleTester.describe = describe;
RuleTester.it = it;

// Rutas reales y absolutas del sistema en el que se ejecuta el test (en Windows, con letra de unidad
// y «\»). ESLint exige rutas absolutas: «/repo/...» no lo es en Windows.
const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const src = (...parts: string[]): string => path.resolve(apiRoot, 'src', ...parts);
const ruleTester = new RuleTester();

ruleTester.run('module-boundaries', moduleBoundaries, {
  valid: [
    {
      filename: src('modules', 'auth', 'auth.service.ts'),
      code: "import { x } from './auth.repository.ts';",
    },
    {
      filename: src('modules', 'finance', 'ledger', 'a.ts'),
      code: "import { x } from '../plan/b.ts';",
    },
    {
      filename: src('modules', 'imports', 'imports.service.ts'),
      code: "import { x } from '../finance/index.ts';",
    },
    { filename: src('container.ts'), code: "import { x } from './modules/auth/index.ts';" },
    { filename: src('modules', 'auth', 'a.ts'), code: "import { x } from '../../http/errors.ts';" },
    { filename: src('modules', 'auth', 'a.ts'), code: "import { z } from 'zod';" },
  ],
  invalid: [
    {
      filename: src('modules', 'imports', 'imports.service.ts'),
      code: "import { x } from '../finance/ledger/movements.repository.ts';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      filename: src('container.ts'),
      code: "export { x } from './modules/auth/auth.repository.ts';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      filename: src('jobs', 'scheduler.ts'),
      code: "const m = await import('../modules/tasks/tasks.service.ts');",
      errors: [{ messageId: 'deepImport' }],
    },
  ],
});

// La lógica de rutas se prueba también con rutas de estilo Windows (con «\» y letra de unidad) y de
// estilo POSIX, en cualquier sistema: si la regla dependiera de un separador, no detectaría nada.
describe('module-boundaries con rutas de Windows y POSIX', () => {
  const windowsFile = 'C:\\repo\\apps\\api\\src\\modules\\imports\\imports.service.ts';
  const windowsFileWithSlashes = 'C:/repo/apps/api/src/modules/imports/imports.service.ts';
  const posixFile = '/repo/apps/api/src/modules/imports/imports.service.ts';

  it.each([windowsFile, windowsFileWithSlashes, posixFile])('reconoce el módulo en %s', (file) => {
    expect(moduleOf(file)).toBe('imports');
  });

  it.each([windowsFile, windowsFileWithSlashes, posixFile])(
    'detecta la importación interna de otro módulo desde %s',
    (file) => {
      expect(deepImportTarget(file, '../finance/ledger/movements.repository.ts')).toBe('finance');
    },
  );

  it.each([windowsFile, windowsFileWithSlashes, posixFile])(
    'permite el index.ts del otro módulo y los imports internos desde %s',
    (file) => {
      expect(deepImportTarget(file, '../finance/index.ts')).toBeNull();
      expect(deepImportTarget(file, './imports.repository.ts')).toBeNull();
      expect(deepImportTarget(file, '../../http/errors.ts')).toBeNull();
      expect(deepImportTarget(file, 'zod')).toBeNull();
    },
  );

  it('normaliza los separadores', () => {
    expect(toPosixPath('C:\\a\\b')).toBe('C:/a/b');
    expect(toPosixPath('/a/b')).toBe('/a/b');
  });

  it('la ruta real de este sistema contiene src/modules tras normalizarla', () => {
    expect(moduleOf(src('modules', 'notes', 'x.ts'))).toBe('notes');
  });
});
