/**
 * Comprobación previa del archivo que se va a subir. Es solo una ayuda: ahorra enviar hasta 5 MB para que
 * la API responda 413 o 415. La API vuelve a comprobarlo todo (tamaño, extensión Y contenido real, ASVS
 * 5.2.1 y 5.2.2) y es la que decide; nada de lo de aquí es un control de seguridad.
 */

/** Copia del límite de la API (`MAX_FILE_BYTES` de `imports/domain/template.ts`): 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
} as const;

export type SpreadsheetExtension = keyof typeof CONTENT_TYPES;

/** Extensión en minúsculas, sin el punto (`''` si no hay). */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** `.xlsx` o `.xlsm`, o `null` para cualquier otra. */
export function spreadsheetExtension(fileName: string): SpreadsheetExtension | null {
  const extension = extensionOf(fileName);
  return extension === 'xlsx' || extension === 'xlsm' ? extension : null;
}

/**
 * Tipo de contenido de la petición. Lo fija la extensión, no `file.type` (que decide el navegador o el
 * sistema operativo y puede venir vacío o ser cualquier cosa).
 */
export function contentTypeFor(extension: SpreadsheetExtension): string {
  return CONTENT_TYPES[extension];
}

/** Tamaño legible: `5,3 MB`. Solo para mensajes (no es un importe). */
export function formatFileSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 0.1) {
    return `${megabytes.toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es-ES')} KB`;
}

export interface FileCheck {
  /** Impiden enviar el archivo. */
  readonly blocking: readonly string[];
  /** Se puede enviar, pero conviene saberlo. */
  readonly warnings: readonly string[];
}

/** Avisos y bloqueos de un archivo elegido, antes de enviarlo. */
export function checkFile(file: { readonly name: string; readonly size: number }): FileCheck {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const extension = spreadsheetExtension(file.name);
  if (extension === null) {
    blocking.push(
      'Solo se pueden importar archivos .xlsx o .xlsm (recomendado: .xlsx). Guarda el libro como .xlsx y vuelve a elegirlo.',
    );
  } else if (extension === 'xlsm') {
    warnings.push(
      'Se recomienda .xlsx. Un .xlsm solo se acepta si no contiene macros: la importación no las ejecuta y las rechaza.',
    );
  }
  if (file.size === 0) {
    blocking.push('El archivo está vacío.');
  } else if (file.size > MAX_UPLOAD_BYTES) {
    blocking.push(
      `El archivo pesa ${formatFileSize(file.size)} y el máximo es ${formatFileSize(MAX_UPLOAD_BYTES)}. Quita hojas o datos que no sean de la plantilla y vuelve a elegirlo.`,
    );
  }
  return { blocking, warnings };
}
