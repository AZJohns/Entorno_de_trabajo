/**
 * Mensajes en español de los errores de la importación. La interfaz decide por el código HTTP y, en los
 * 409, por la razón estable de `errors[].path` (nunca por el texto). Los textos que vienen de la API (el
 * detalle de cada problema, el nombre de las categorías que chocan) se devuelven en `details` como cadenas
 * y se pintan como texto de React; nunca como HTML.
 */
import { isApiError, type ApiError } from '../api/client.ts';
import { MAX_UPLOAD_BYTES, formatFileSize } from './fileCheck.ts';

/** Dónde ocurrió el error: algunos códigos significan cosas distintas según la operación. */
export type ImportAction = 'upload' | 'read' | 'decisions' | 'confirm' | 'discard';

export interface ImportNotice {
  readonly title: string;
  readonly message: string;
  /** Líneas de detalle que envía la API (errores bloqueantes, categorías que chocan…). */
  readonly details: readonly string[];
  /** Tiene sentido ofrecer «subir otro archivo» (el lote ya no sirve). */
  readonly offerReupload: boolean;
}

/** Razones de un 409 que decide la interfaz (`docs/plan.md` §3.10). */
export const CONFLICT_REASONS = [
  'IMPORT_NOT_PREVIEW',
  'IMPORT_EXPIRED',
  'IMPORT_HAS_ERRORS',
  'CONTENT_ALREADY_IMPORTED',
  'BUDGET_MANUAL_EXISTS',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** Primera razón conocida en `errors[].path` de la respuesta, o `null`. */
export function conflictReason(error: ApiError): ConflictReason | null {
  for (const field of error.problem?.errors ?? []) {
    const reason = CONFLICT_REASONS.find((known) => known === field.path);
    if (reason !== undefined) return reason;
  }
  return null;
}

/** Mensajes de detalle de la API (`errors[].message`), sin repetir el principal. */
function detailsOf(error: ApiError): string[] {
  return (error.problem?.errors ?? [])
    .map((field) => field.message)
    .filter((text) => text !== error.message);
}

function notice(
  title: string,
  message: string,
  extra: { details?: readonly string[]; offerReupload?: boolean } = {},
): ImportNotice {
  return {
    title,
    message,
    details: extra.details ?? [],
    offerReupload: extra.offerReupload ?? false,
  };
}

function conflictNotice(error: ApiError, action: ImportAction): ImportNotice {
  switch (conflictReason(error)) {
    case 'IMPORT_NOT_PREVIEW':
      return notice(
        'Esta importación ya no está en vista previa',
        'Ya se confirmó, se descartó o falló la lectura del archivo, así que no se puede cambiar ni confirmar. Si quieres importar el archivo otra vez, súbelo de nuevo.',
        { offerReupload: true },
      );
    case 'IMPORT_EXPIRED':
      return closedNotice('expired');
    case 'IMPORT_HAS_ERRORS':
      return notice(
        'Quedan errores sin resolver',
        'No se puede confirmar mientras haya errores. Elige la categoría de las que faltan o corrige el Excel y vuelve a subirlo.',
        { details: error.problem?.errors?.map((field) => field.message) ?? [] },
      );
    case 'CONTENT_ALREADY_IMPORTED':
      return notice(
        'Este contenido ya se importó antes',
        'Ese mismo contenido fue el plan de este mes y después lo sustituyó otro, así que no se vuelve a activar. Para volver a él, sube el archivo con algún cambio (por pequeño que sea) y confirma esa nueva vista previa.',
        { offerReupload: true },
      );
    case 'BUDGET_MANUAL_EXISTS':
      return notice(
        'Hay presupuestos creados a mano que chocan',
        'Estas categorías ya tienen un presupuesto creado a mano en ese mes. Los presupuestos manuales no se tocan y no se ha cambiado nada. Bórralos o edítalos en Presupuesto, o elige otra categoría aquí.',
        { details: error.problem?.errors?.map((field) => field.message) ?? [] },
      );
    case null:
      // Sin razón conocida (p. ej. una categoría archivada, que no tiene código propio): el texto de la API.
      return notice('No se puede hacer ahora', error.message, {
        details: detailsOf(error),
        offerReupload: action === 'confirm' || action === 'decisions',
      });
  }
}

/** Código del problema de nivel 1 en `errors[].path` de un 422 de la subida. */
function uploadRejection(error: ApiError): ImportNotice {
  const paths = new Set((error.problem?.errors ?? []).map((field) => field.path));
  if (paths.has('FILE_HAS_MACROS')) {
    return notice(
      'El archivo contiene macros',
      'Las macros no se ejecutan ni se importan. Guarda una copia como libro de Excel (.xlsx), sin macros, y súbela.',
    );
  }
  if (paths.has('FILE_EXTERNAL_LINKS')) {
    return notice(
      'El archivo tiene vínculos a otros libros',
      'Los vínculos externos no se siguen. Rompe los vínculos (Datos → Editar vínculos → Romper vínculo), guarda y vuelve a subirlo.',
    );
  }
  if (paths.has('FILE_ZIP_LIMITS')) {
    return notice(
      'El archivo supera los límites de seguridad',
      'Tiene demasiadas partes, celdas, filas o problemas, o ocupa demasiado descomprimido. Importa solo las hojas de la plantilla.',
    );
  }
  return notice('El archivo no se puede importar', error.message, { details: detailsOf(error) });
}

/** Aviso de un lote que ya no está en vista previa (se lee con `GET`, no es un error de la API). */
export function closedNotice(status: 'expired' | 'discarded'): ImportNotice {
  return status === 'expired'
    ? notice(
        'La vista previa caducó',
        'Las vistas previas duran 24 horas y esta ya no se puede usar. Vuelve a subir el archivo para empezar de nuevo.',
        { offerReupload: true },
      )
    : notice(
        'Esta importación se descartó',
        'No se escribió nada en el plan. Si quieres importar el archivo, súbelo de nuevo.',
        { offerReupload: true },
      );
}

/**
 * Mensaje para un error de la API (o de red) según la operación que lo causó.
 * 400, 404, 409, 413, 415 y 422 tienen texto propio; el resto usa el de la API.
 */
export function importNotice(error: unknown, action: ImportAction): ImportNotice {
  if (!isApiError(error)) {
    return notice('No se ha podido completar', 'Ha ocurrido un error inesperado');
  }
  switch (error.status) {
    case 0:
      return notice('Sin conexión', 'No se pudo conectar con el servidor. Inténtalo de nuevo.');
    case 400:
      return notice('La petición no es válida', error.message, { details: detailsOf(error) });
    case 403:
      return error.code === 'REAUTH_REQUIRED'
        ? notice(
            'Hace falta confirmar tu identidad',
            'Subir un archivo exige haber iniciado sesión o reautenticado hace menos de 10 minutos. Tras hacerlo, vuelve a elegir el archivo.',
          )
        : notice('No permitido', error.message);
    case 404:
      return notice(
        'La importación no existe',
        'Puede que se haya descartado o que el enlace no sea correcto. Sube el archivo de nuevo.',
        { offerReupload: true },
      );
    case 409:
      return conflictNotice(error, action);
    case 413:
      return notice(
        'El archivo es demasiado grande',
        `El máximo es ${formatFileSize(MAX_UPLOAD_BYTES)}. Quita hojas o datos que no sean de la plantilla y vuelve a subirlo.`,
      );
    case 415:
      return notice(
        'No es un libro de Excel',
        'El archivo no es un .xlsx o .xlsm válido (se comprueba su contenido, no solo el nombre). Ábrelo en Excel, guárdalo como .xlsx y vuelve a subirlo.',
      );
    case 422:
      return action === 'upload'
        ? uploadRejection(error)
        : notice('Esa decisión no es coherente', error.message, { details: detailsOf(error) });
    default:
      return notice('No se ha podido completar', error.message, { details: detailsOf(error) });
  }
}
