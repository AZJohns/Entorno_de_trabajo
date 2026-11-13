/**
 * Problemas de la importación, agrupados por severidad y por hoja. Los textos (hoja, celda, mensaje,
 * valores) salen del Excel o del lector: se pintan como texto de React, nunca como HTML.
 */
import type { ImportIssue, IssueSeverity } from '@backoffice/shared';
import { groupIssues } from './previewLogic.ts';

const TITLES: Record<IssueSeverity, string> = {
  error: 'Errores',
  warning: 'Avisos',
  info: 'Información',
};

const MARKS: Record<IssueSeverity, string> = { error: '✕', warning: '⚠', info: 'ℹ' };

const TONES: Record<IssueSeverity, string> = {
  error: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-white text-slate-800',
};

function IssueItem({ issue }: { issue: ImportIssue }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span>
        {issue.cell !== null && <span className="mr-2 font-mono text-xs">{issue.cell}</span>}
        {issue.message}
      </span>
      {(issue.expected !== undefined || issue.found !== undefined) && (
        <span className="text-xs">
          {issue.expected !== undefined && <>Esperado: {issue.expected}. </>}
          {issue.found !== undefined && <>Encontrado: {issue.found}.</>}
        </span>
      )}
      <span className="font-mono text-xs opacity-70">{issue.code}</span>
    </li>
  );
}

function Group({ group }: { group: ReturnType<typeof groupIssues>[number] }) {
  const heading = `${TITLES[group.severity]} (${String(group.total)})`;
  const body = group.sheets.map((entry) => (
    <div key={entry.sheet ?? '__general'} className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold">{entry.sheet ?? 'General'}</h4>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
        {entry.issues.map((issue, index) => (
          <IssueItem key={`${issue.code}-${issue.cell ?? ''}-${String(index)}`} issue={issue} />
        ))}
      </ul>
    </div>
  ));
  const classes = `flex flex-col gap-2 rounded-lg border p-3 ${TONES[group.severity]}`;
  // La información va plegada (es la menos importante); errores y avisos, siempre a la vista.
  if (group.severity === 'info') {
    return (
      <details className={classes}>
        <summary className="cursor-pointer text-base font-semibold">
          <span aria-hidden="true">{MARKS[group.severity]} </span>
          {heading}
        </summary>
        <div className="mt-2 flex flex-col gap-3">{body}</div>
      </details>
    );
  }
  return (
    <section className={classes} aria-label={heading}>
      <h3 className="text-base font-semibold">
        <span aria-hidden="true">{MARKS[group.severity]} </span>
        {heading}
      </h3>
      {body}
    </section>
  );
}

export function IssuesPanel({ issues }: { issues: readonly ImportIssue[] }) {
  const groups = groupIssues(issues);
  if (groups.length === 0) {
    return <p className="text-sm text-slate-600">El archivo no tiene errores ni avisos.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <Group key={group.severity} group={group} />
      ))}
    </div>
  );
}
