/**
 * Nivel 1 de la validación: el archivo (docs/plantilla-excel.md §2, ASVS V5). Se decide por el CONTENIDO,
 * no por el tipo MIME que declara el navegador ni solo por la extensión.
 */
import type { ImportIssue } from '@backoffice/shared';
import { IssueCollector } from './issues.ts';
import { MAX_FILE_BYTES, MAX_UNCOMPRESSED_BYTES, MAX_ZIP_ENTRIES } from './template.ts';
import { openZip, ZipFormatError, ZipLimitError, type ZipArchive } from './zip.ts';

export type FileCheck =
  | { readonly ok: true; readonly archive: ZipArchive }
  | { readonly ok: false; readonly issues: ImportIssue[] };

/** Firma de la cabecera local de un ZIP: `PK\x03\x04`. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Comprueba tamaño, extensión, firma ZIP, estructura OOXML, límites de descompresión, macros y vínculos
 * externos. No descomprime nada: usa solo el directorio central del ZIP.
 */
export function checkFile(bytes: Buffer, fileName: string): FileCheck {
  const issues = new IssueCollector();
  if (bytes.length > MAX_FILE_BYTES) {
    issues.add(
      'FILE_TOO_LARGE',
      null,
      null,
      null,
      `El archivo supera el tamaño máximo de ${String(MAX_FILE_BYTES / (1024 * 1024))} MB`,
      {
        expected: `≤ ${String(MAX_FILE_BYTES)} bytes`,
        found: `${String(bytes.length)} bytes`,
      },
    );
    return { ok: false, issues: issues.issues };
  }
  if (!/\.(xlsx|xlsm)$/iu.test(fileName)) {
    issues.add(
      'FILE_NOT_OOXML',
      null,
      null,
      null,
      'La extensión del archivo debe ser .xlsx (o .xlsm)',
      {
        expected: '.xlsx, .xlsm',
      },
    );
  }
  if (bytes.length < ZIP_MAGIC.length || !bytes.subarray(0, 4).equals(ZIP_MAGIC)) {
    issues.add(
      'FILE_NOT_OOXML',
      null,
      null,
      null,
      'El contenido no es un libro de Excel (.xlsx): no es un archivo ZIP',
    );
    return { ok: false, issues: issues.issues };
  }

  let archive: ZipArchive;
  try {
    archive = openZip(bytes, {
      maxEntries: MAX_ZIP_ENTRIES,
      maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
    });
  } catch (error) {
    if (error instanceof ZipLimitError) {
      issues.add(
        'FILE_ZIP_LIMITS',
        null,
        null,
        null,
        `El archivo supera los límites de descompresión: ${error.message}`,
      );
    } else if (error instanceof ZipFormatError) {
      issues.add(
        'FILE_NOT_OOXML',
        null,
        null,
        null,
        `El archivo no es un ZIP válido: ${error.message}`,
      );
    } else {
      throw error;
    }
    return { ok: false, issues: issues.issues };
  }

  if (!archive.has('[Content_Types].xml') || !archive.has('xl/workbook.xml')) {
    issues.add(
      'FILE_NOT_OOXML',
      null,
      null,
      null,
      'El ZIP no es un libro de Excel: faltan [Content_Types].xml o xl/workbook.xml',
    );
    return { ok: false, issues: issues.issues };
  }
  const names = archive.names().map((name) => name.toLowerCase());
  if (names.includes('xl/vbaproject.bin')) {
    issues.add(
      'FILE_HAS_MACROS',
      null,
      null,
      null,
      'El archivo contiene macros (vbaProject.bin): guárdalo como .xlsx sin macros',
    );
  }
  if (names.some((name) => name.startsWith('xl/externallinks/'))) {
    issues.add(
      'FILE_EXTERNAL_LINKS',
      null,
      null,
      null,
      'El archivo tiene vínculos a otros libros: elimínalos (Datos → Editar vínculos → Interrumpir vínculo)',
    );
  }
  return issues.issues.length === 0 ? { ok: true, archive } : { ok: false, issues: issues.issues };
}
