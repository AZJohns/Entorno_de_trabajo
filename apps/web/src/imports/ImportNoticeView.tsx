/**
 * Aviso de un error (o de un lote cerrado) de la importación. Todo el texto, también el que viene de la API
 * (problemas del Excel, nombres de categorías), se pinta como texto de React.
 */
import { Link } from 'react-router';
import type { ImportAction, ImportNotice } from './messages.ts';
import { importNotice } from './messages.ts';

/** Enlace de «subir otro archivo»: el lote ya no sirve y hay que empezar de nuevo. */
export function ReuploadLink({ label = 'Subir otro archivo' }: { label?: string }) {
  return (
    <Link
      to="/importar"
      className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
    >
      {label}
    </Link>
  );
}

/** Aviso ya compuesto. `role="alert"`: los lectores de pantalla lo anuncian al aparecer. */
export function NoticeBox({ notice }: { notice: ImportNotice }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      <p className="font-semibold">{notice.title}</p>
      <p>{notice.message}</p>
      {notice.details.length > 0 && (
        <ul className="list-disc pl-5">
          {notice.details.map((line, index) => (
            // El orden es el de la API y no cambia mientras se muestra.
            <li key={`${String(index)}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
      {notice.offerReupload && (
        <div>
          <ReuploadLink />
        </div>
      )}
    </div>
  );
}

/** Aviso de un error de la API según la operación que lo causó; nada si no hay error. */
export function ImportErrorNotice({ error, action }: { error: unknown; action: ImportAction }) {
  if (error === null || error === undefined) return null;
  return <NoticeBox notice={importNotice(error, action)} />;
}
