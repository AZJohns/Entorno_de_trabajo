/**
 * Primer paso de la importación del Excel: elegir el mes y el archivo y subirlo. El archivo se avisa antes
 * de enviar si no es .xlsx/.xlsm o pasa de 5 MB; el límite real y la comprobación del contenido los pone la
 * API. Al subir se pasa a la vista previa (`/importar/:id`).
 */
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, SuccessMessage } from '../ui/forms.tsx';
import { SelectField } from '../ui/finance-forms.tsx';
import { formatMonth, monthOf, shiftMonth, todayLocal } from '../finance/dates.ts';
import { checkFile } from './fileCheck.ts';
import { ImportErrorNotice } from './ImportNoticeView.tsx';
import { useUploadImport } from './queries.ts';

/** Meses que se ofrecen: 12 hacia atrás y 3 hacia delante desde el actual. */
const MONTHS_BACK = 12;
const MONTHS_AHEAD = 3;

export function ImportUploadPage() {
  const navigate = useNavigate();
  const upload = useUploadImport();
  const current = monthOf(todayLocal());
  const [month, setMonth] = useState(current);
  const [file, setFile] = useState<File | null>(null);
  const fileId = useId();

  const options = Array.from({ length: MONTHS_BACK + MONTHS_AHEAD + 1 }, (_, i) => {
    const value = shiftMonth(current, MONTHS_AHEAD - i);
    return { value, label: formatMonth(value) };
  });
  const check = file === null ? null : checkFile(file);
  const blocked = check !== null && check.blocking.length > 0;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (file === null || blocked || upload.isPending) return;
    upload.mutate(
      { month, file },
      {
        onSuccess: (result) => {
          // 201: lote nuevo. 200: ese contenido ya es el plan vigente del mes y no se ha creado nada (se
          // dice aquí mismo, sin llevar a una vista previa que no existe).
          if (result.status === 201) void navigate(`/importar/${result.data.id}`);
        },
      },
    );
  }

  const sameAsCurrent =
    upload.data !== undefined && upload.data.status !== 201 ? upload.data.data : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Importar el plan desde Excel</h1>
      <p className="text-sm text-slate-600">
        Sube el libro de la plantilla (v2). Primero verás una vista previa con los problemas que
        haya; no se guarda nada en el plan hasta que lo confirmes. El archivo no se conserva.
      </p>

      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <SelectField
          label="Mes del plan"
          value={month}
          onChange={(value) => {
            upload.reset();
            setMonth(value);
          }}
          options={options}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor={fileId} className="text-sm font-medium text-slate-700">
            Archivo de Excel (.xlsx o .xlsm)
          </label>
          <input
            id={fileId}
            type="file"
            accept=".xlsx,.xlsm"
            aria-describedby={`${fileId}-hint`}
            onChange={(event) => {
              upload.reset();
              setFile(event.target.files?.item(0) ?? null);
            }}
            className="text-sm"
          />
          <p id={`${fileId}-hint`} className="text-xs text-slate-500">
            Recomendado: .xlsx, hasta 5 MB. Para subirlo hace falta haber iniciado sesión o
            reautenticado hace menos de 10 minutos; si la app te lo pide, tendrás que elegir el
            archivo otra vez al volver.
          </p>
        </div>

        {check !== null && check.blocking.length > 0 && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {check.blocking.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        {check !== null && check.warnings.length > 0 && (
          <div role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {check.warnings.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button disabled={file === null || blocked || upload.isPending}>
            {upload.isPending ? 'Subiendo…' : 'Subir y ver la vista previa'}
          </Button>
          {upload.isPending && (
            <span role="status" className="text-sm text-slate-600">
              Subiendo y leyendo el archivo…
            </span>
          )}
        </div>
      </form>

      <ImportErrorNotice error={upload.error} action="upload" />

      {sameAsCurrent !== null && (
        <div className="flex flex-col gap-2">
          <SuccessMessage>
            Ese contenido ya es el plan vigente de {formatMonth(month)}: no se ha creado nada.
          </SuccessMessage>
          <p className="text-sm">
            <Link to={`/importar/${sameAsCurrent.id}`} className="underline">
              Ver esa importación
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
