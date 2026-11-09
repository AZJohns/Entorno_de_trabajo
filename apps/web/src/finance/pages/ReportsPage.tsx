/**
 * Informes: balance mensual, desglose por categoría, saldo por cuenta (con los ajustes de conciliación
 * en su propia columna) y los tres gráficos. Todas las cifras las calcula la API.
 */
import { useState } from 'react';
import { Button, ErrorMessage, Loading, SuccessMessage } from '../../ui/forms.tsx';
import { SelectField } from '../../ui/finance-forms.tsx';
import { money } from '../amount.ts';
import { formatMonth, monthOf, shiftMonth, todayLocal } from '../dates.ts';
import { BalanceLinesChart } from '../charts/BalanceLinesChart.tsx';
import { CategoryBarsChart } from '../charts/CategoryBarsChart.tsx';
import { MonthlyBarsChart } from '../charts/MonthlyBarsChart.tsx';
import {
  useBalanceHistory,
  useBalancesReport,
  useCategoryReport,
  useExportData,
  useMonthlyReport,
} from '../queries.ts';

/** Meses que se muestran: el actual y los 11 anteriores. */
const MONTHS_SHOWN = 12;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ReportsPage() {
  const today = todayLocal();
  const to = monthOf(today);
  const from = shiftMonth(to, -(MONTHS_SHOWN - 1));
  const [month, setMonth] = useState(to);

  const exportData = useExportData();
  const monthly = useMonthlyReport(from, to);
  const categories = useCategoryReport(month);
  const balances = useBalancesReport(today);
  const history = useBalanceHistory(from, to);

  const monthOptions = Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftMonth(to, -i)).map(
    (value) => ({ value, label: formatMonth(value) }),
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Informes</h1>

      <Section title="Exportar datos">
        <p className="mb-3 text-sm text-slate-600">
          Descarga una copia legible (JSON) de cuentas, categorías, movimientos, transferencias,
          presupuestos y conciliaciones, con los importes en céntimos. Pide volver a introducir la
          contraseña y el código si hace más de 10 minutos que lo hiciste. No incluye datos de
          acceso.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={exportData.isPending}
          onClick={() => {
            exportData.mutate();
          }}
        >
          {exportData.isPending ? 'Exportando…' : 'Exportar datos'}
        </Button>
        {exportData.isError && <ErrorMessage error={exportData.error} />}
        {exportData.isSuccess && <SuccessMessage>Copia descargada.</SuccessMessage>}
      </Section>

      <Section title="Balance mensual">
        {monthly.isPending ? (
          <Loading />
        ) : monthly.isError ? (
          <ErrorMessage error={monthly.error} />
        ) : (
          <MonthlyBarsChart rows={monthly.data.items} />
        )}
      </Section>

      <Section title="Desglose por categoría">
        <div className="mb-3 max-w-xs">
          <SelectField label="Mes" value={month} onChange={setMonth} options={monthOptions} />
        </div>
        {categories.isPending ? (
          <Loading />
        ) : categories.isError ? (
          <ErrorMessage error={categories.error} />
        ) : (
          <CategoryBarsChart report={categories.data} />
        )}
      </Section>

      <Section title={`Saldo por cuenta a ${today.split('-').reverse().join('/')}`}>
        {balances.isPending ? (
          <Loading />
        ) : balances.isError ? (
          <ErrorMessage error={balances.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-sm">
              <caption className="sr-only">
                Saldo por cuenta, con los ajustes de conciliación aparte
              </caption>
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className="py-1 pr-3 text-left">
                    Cuenta
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Saldo
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    De ello, ajustes de conciliación
                  </th>
                </tr>
              </thead>
              <tbody>
                {balances.data.accounts
                  .filter((a) => !(a.archived && a.balanceCents === 0 && a.adjustmentsCents === 0))
                  .map((account) => (
                    <tr key={account.accountId} className="border-b border-slate-100">
                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                        {account.name}
                        {account.archived ? ' (archivada)' : ''}
                      </th>
                      <td className="py-1 pr-3 tabular-nums">{money(account.balanceCents)}</td>
                      <td className="py-1 pr-3 tabular-nums">{money(account.adjustmentsCents)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <th scope="row" className="py-1 pr-3 text-left">
                    Total
                  </th>
                  <td className="py-1 pr-3 tabular-nums">{money(balances.data.totalCents)}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    {money(balances.data.totalAdjustmentsCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      <Section title="Evolución del saldo">
        {history.isPending ? (
          <Loading />
        ) : history.isError ? (
          <ErrorMessage error={history.error} />
        ) : (
          <BalanceLinesChart history={history.data} />
        )}
      </Section>
    </div>
  );
}
