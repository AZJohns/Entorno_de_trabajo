/**
 * Segundo paso de la importación: vista previa de lo leído, problemas, correspondencia de categorías y
 * confirmación. El estado sale de `GET /imports/:id`: vista previa, caducada, confirmada, descartada o
 * fallida; «confirmando» es el estado de la mutación.
 *
 * Todo texto que viene del Excel (nombre del archivo, hojas, celdas, conceptos y categorías) se pinta como
 * texto de React. Aquí no hay `dangerouslySetInnerHTML` ni HTML construido a mano (lo impide ESLint).
 */
import type { ImportDetailResponse } from '@backoffice/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { money } from '../finance/amount.ts';
import { formatMonth } from '../finance/dates.ts';
import { useCategories } from '../finance/queries.ts';
import { Button, ErrorMessage, Loading, SuccessMessage } from '../ui/forms.tsx';
import { ConfirmBar } from '../ui/finance-forms.tsx';
import { formatMadridMoment } from '../ui/moment.ts';
import { CategoryDecisions } from './CategoryDecisions.tsx';
import { formatFileSize } from './fileCheck.ts';
import { ImportErrorNotice, NoticeBox, ReuploadLink } from './ImportNoticeView.tsx';
import { IssuesPanel } from './IssuesPanel.tsx';
import { closedNotice } from './messages.ts';
import {
  blockingText,
  categoryRows,
  confirmOutcome,
  lineAmountCents,
  type ConfirmOutcome,
} from './previewLogic.ts';
import { useConfirmImport, useDiscardImport, useImport, useUpdateDecisions } from './queries.ts';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular-nums break-words">{value}</dd>
    </div>
  );
}

function Summary({ summary }: { summary: ImportDetailResponse['summary'] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <Fact label="Datos y supuestos" value={String(summary.items)} />
      <Fact label="Líneas de presupuesto" value={String(summary.budgetLines)} />
      <Fact label="Eventos" value={String(summary.events)} />
      <Fact label="Metas" value={String(summary.goals)} />
      <Fact label="Escenarios" value={String(summary.scenarios)} />
      <Fact label="Errores" value={String(summary.errors)} />
      <Fact label="Avisos" value={String(summary.warnings)} />
      <Fact label="Información" value={String(summary.infos)} />
    </dl>
  );
}

function BudgetLines({
  detail,
  categoryNames,
}: {
  detail: ImportDetailResponse;
  categoryNames: ReadonlyMap<string, string>;
}) {
  const extracted = detail.extracted;
  if (extracted === null || extracted.budgetLines.length === 0) return null;
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-base font-semibold">
        Líneas de presupuesto ({extracted.budgetLines.length})
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Líneas de la hoja Presupuesto con su importe mensual
          </caption>
          <thead>
            <tr className="text-xs text-slate-500">
              <th scope="col" className="py-1 pr-3 font-medium">
                Categoría del Excel
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Concepto
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                Mensual
              </th>
              <th scope="col" className="py-1 font-medium">
                Categoría de la app
              </th>
            </tr>
          </thead>
          <tbody>
            {extracted.budgetLines.map((line) => {
              const cents = lineAmountCents(extracted, line);
              return (
                <tr key={line.sourceRow} className="border-t border-slate-100">
                  <td className="py-1 pr-3 break-words">{line.categoryLabel}</td>
                  <td className="py-1 pr-3 break-words">{line.concept}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {cents === null ? '—' : money(cents)}
                  </td>
                  <td className="py-1 break-words">
                    {line.categoryId === null
                      ? 'Sin categoría'
                      : (categoryNames.get(line.categoryId) ?? 'Categoría archivada')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const BUDGET_LABELS = [
  ['created', 'Presupuestos creados'],
  ['updated', 'Presupuestos actualizados'],
  ['deleted', 'Presupuestos borrados'],
  ['omitted', 'Categorías sin presupuesto (suman 0)'],
] as const;

function ConfirmedPanel({
  detail,
  outcome,
  budgets,
}: {
  detail: ImportDetailResponse;
  outcome: ConfirmOutcome | null;
  budgets: Record<(typeof BUDGET_LABELS)[number][0], number> | null;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label="Resultado de la importación">
      {outcome === 'created' && budgets !== null ? (
        <>
          <SuccessMessage>
            Importación confirmada: el plan de {formatMonth(detail.month)} está al día.
          </SuccessMessage>
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
            {BUDGET_LABELS.map(([key, label]) => (
              <Fact key={key} label={label} value={String(budgets[key])} />
            ))}
          </dl>
        </>
      ) : outcome === 'already-confirmed' ? (
        <SuccessMessage>
          Esta importación ya estaba confirmada: no se ha vuelto a escribir nada.
        </SuccessMessage>
      ) : (
        <SuccessMessage>
          Esta importación está confirmada
          {detail.confirmedAt === null ? '' : ` (${formatMadridMoment(detail.confirmedAt)})`}. Para
          cambiar el plan de {formatMonth(detail.month)}, sube otro archivo.
        </SuccessMessage>
      )}
      <div className="flex flex-wrap gap-3">
        <Link
          to="/presupuesto"
          className="inline-block rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Ver presupuesto
        </Link>
        <ReuploadLink label="Importar otro archivo" />
      </div>
    </section>
  );
}

function PreviewBody({ detail }: { detail: ImportDetailResponse }) {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const blockingId = useId();
  const categories = useCategories(false);
  const decisions = useUpdateDecisions(detail.id);
  const confirm = useConfirmImport(detail.id);
  const discard = useDiscardImport(detail.id);
  const [discarding, setDiscarding] = useState(false);

  // Al llegar desde la subida, el foco pasa al título: quien usa teclado o lector no se queda en un botón que ya no existe.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const outcome: ConfirmOutcome | null =
    confirm.data === undefined
      ? null
      : confirmOutcome(confirm.data.status, confirm.data.data.budgets, detail.status);
  const confirmed = detail.status === 'confirmed';
  const inPreview = detail.status === 'preview';
  // Mismo contenido que el plan vigente: el lote sigue en vista previa, pero no hay nada que confirmar.
  const noChanges = inPreview && outcome === 'no-changes';
  const canConfirm = inPreview && detail.summary.canConfirm && !noChanges;

  const names = new Map((categories.data ?? []).map((category) => [category.id, category.name]));
  const rows = detail.extracted === null ? [] : categoryRows(detail.extracted);

  return (
    <div className="flex flex-col gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
        Importación de {formatMonth(detail.month)}
      </h1>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
        <Fact label="Archivo" value={detail.fileName} />
        <Fact label="Tamaño" value={formatFileSize(detail.fileSizeBytes)} />
        <Fact
          label="Versión de la plantilla"
          value={detail.templateVersion === null ? 'No reconocida' : String(detail.templateVersion)}
        />
        {inPreview && <Fact label="Caduca" value={formatMadridMoment(detail.expiresAt)} />}
      </dl>

      {(detail.status === 'expired' || detail.status === 'discarded') && (
        <NoticeBox notice={closedNotice(detail.status)} />
      )}

      {confirmed && (
        <ConfirmedPanel
          detail={detail}
          outcome={outcome}
          budgets={confirm.data?.data.budgets ?? null}
        />
      )}

      {detail.status === 'failed' && (
        <>
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-semibold">El archivo no tiene la estructura de la plantilla</p>
            <p>
              No se ha podido leer, así que no hay nada que confirmar. Corrige lo que se indica
              abajo y súbelo otra vez.
            </p>
          </div>
          <IssuesPanel issues={detail.issues} />
          <div>
            <ReuploadLink />
          </div>
        </>
      )}

      {inPreview && (
        <>
          <section aria-labelledby="preview-summary" className="flex flex-col gap-3">
            <h2 id="preview-summary" className="text-lg font-semibold">
              Lo que se ha leído
            </h2>
            <Summary summary={detail.summary} />
          </section>

          <section aria-labelledby="preview-issues" className="flex flex-col gap-3">
            <h2 id="preview-issues" className="text-lg font-semibold">
              Problemas
            </h2>
            <IssuesPanel issues={detail.issues} />
          </section>

          {rows.length > 0 && (
            <section aria-labelledby="preview-categories" className="flex flex-col gap-3">
              <h2 id="preview-categories" className="text-lg font-semibold">
                Categorías
              </h2>
              <p className="text-sm text-slate-600">
                Elige a qué categoría de gasto de la app corresponde cada una. Solo se ofrecen las
                de gasto que no están archivadas. Lo que elijas se recuerda para los meses
                siguientes.
              </p>
              <ErrorMessage error={categories.error} />
              <CategoryDecisions
                rows={rows}
                categories={categories.data ?? []}
                disabled={decisions.isPending || categories.data === undefined}
                onChoose={(categoryKey, categoryId) => {
                  confirm.reset();
                  decisions.mutate([{ categoryKey, categoryId }]);
                }}
              />
              <ImportErrorNotice error={decisions.error} action="decisions" />
            </section>
          )}

          <BudgetLines detail={detail} categoryNames={names} />

          <section aria-labelledby="preview-actions" className="flex flex-col gap-3">
            <h2 id="preview-actions" className="text-lg font-semibold">
              Confirmar
            </h2>
            {noChanges ? (
              <SuccessMessage>
                No había cambios: el contenido es igual al plan vigente de{' '}
                {formatMonth(detail.month)}. No se ha creado nada.
              </SuccessMessage>
            ) : (
              <>
                {/* Región «viva»: al resolver una categoría, el texto cambia y se anuncia. */}
                <p id={blockingId} role="status" className="text-sm text-slate-700">
                  {detail.summary.canConfirm
                    ? 'No hay errores: se puede confirmar.'
                    : blockingText(detail.summary.errors)}
                </p>
                <p className="text-sm text-slate-600">
                  Al confirmar se sustituye el plan vigente del mes y los presupuestos que importó
                  antes. Los presupuestos creados a mano no se tocan.
                </p>
              </>
            )}
            <ImportErrorNotice error={confirm.error} action="confirm" />
            <ImportErrorNotice error={discard.error} action="discard" />
            <div className="flex flex-wrap items-center gap-3">
              {!noChanges && (
                <Button
                  type="button"
                  disabled={!canConfirm || confirm.isPending || decisions.isPending}
                  describedBy={blockingId}
                  onClick={() => {
                    confirm.reset();
                    confirm.mutate();
                  }}
                >
                  {confirm.isPending ? 'Confirmando…' : 'Confirmar importación'}
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => setDiscarding(true)}>
                Descartar
              </Button>
              <ReuploadLink label={noChanges ? 'Volver' : 'Subir otro archivo'} />
            </div>
            {discarding && (
              <ConfirmBar
                message="¿Descartar esta vista previa? No se ha escrito nada en el plan."
                confirmLabel="Descartar"
                pending={discard.isPending}
                onConfirm={() =>
                  discard.mutate(undefined, {
                    onSuccess: () => void navigate('/importar'),
                    onSettled: () => setDiscarding(false),
                  })
                }
                onCancel={() => setDiscarding(false)}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function ImportPreviewPage() {
  const { id = '' } = useParams();
  const detail = useImport(id);
  if (detail.isPending) return <Loading />;
  if (detail.error !== null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Importación</h1>
        <ImportErrorNotice error={detail.error} action="read" />
        <div>
          <ReuploadLink />
        </div>
      </div>
    );
  }
  return <PreviewBody detail={detail.data} />;
}
