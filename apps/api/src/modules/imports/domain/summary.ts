/**
 * Recuentos de la vista previa: solo cuentan entradas y problemas; nunca importes calculados.
 */
import type { ExtractedPlan, ImportIssue, ImportSummary } from '@backoffice/shared';

/** `plan` es `null` cuando ya no hay entradas (tras confirmar, descartar o caducar, o si falló). */
export function summarize(
  plan: ExtractedPlan | null,
  issues: readonly ImportIssue[],
): ImportSummary {
  const count = (severity: ImportIssue['severity']): number =>
    issues.filter((issue) => issue.severity === severity).length;
  const errors = count('error');
  return {
    items: plan?.items.length ?? 0,
    budgetLines: plan?.budgetLines.length ?? 0,
    events: plan?.events.length ?? 0,
    goals: plan?.goals.length ?? 0,
    scenarios: plan?.scenarios.length ?? 0,
    errors,
    warnings: count('warning'),
    infos: count('info'),
    canConfirm: plan !== null && errors === 0,
  };
}
