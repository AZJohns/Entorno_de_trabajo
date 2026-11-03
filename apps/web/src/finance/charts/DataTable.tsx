/**
 * Tabla con los mismos datos que un gráfico: es su alternativa textual (lectores de pantalla, copiar
 * cifras exactas) y la única forma de ver los importes sin interpretar la escala.
 */
import type { ReactNode } from 'react';

export interface DataTableProps {
  readonly caption: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
}

export function DataTable({ caption, head, rows }: DataTableProps) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-slate-600">Ver los datos en una tabla</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-right">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-slate-200">
              {head.map((title, index) => (
                <th
                  key={title}
                  scope="col"
                  className={`py-1 pr-3 ${index === 0 ? 'text-left' : ''}`}
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-slate-100">
                {row.map((cell, index) =>
                  index === 0 ? (
                    <th key={index} scope="row" className="py-1 pr-3 text-left font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={index} className="py-1 pr-3 tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
