/**
 * Genera `plan-ficticio-v2.xlsx` desde el libro válido FICTICIO de `plan-workbook.ts` (nunca desde un archivo
 * real). Uso: `pnpm --filter @backoffice/api fixtures:build`.
 *
 * Es una fixture PROVISIONAL (docs/plantilla-excel.md §12 pide una guardada por Excel): la escribe este
 * código, no Excel, así que no prueba las fórmulas compartidas ni los formatos tal como los guarda Excel.
 * Ver docs/guia-fixture-excel.md para sustituirla.
 */
import { writeFileSync } from 'node:fs';
import { buildValidWorkbook } from './plan-workbook.ts';

const target = new URL('./plan-ficticio-v2.xlsx', import.meta.url);
const bytes = buildValidWorkbook().toBuffer();
writeFileSync(target, bytes);
console.log(`Escrito ${target.pathname} (${String(bytes.length)} bytes)`);
