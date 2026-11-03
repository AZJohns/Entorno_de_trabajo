/**
 * API pública del módulo de finanzas. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import { createLedgerController } from './ledger/ledger.controller.ts';
import { createLedgerRouter } from './ledger/ledger.routes.ts';
import { LedgerService } from './ledger/ledger.service.ts';

export type { LedgerService } from './ledger/ledger.service.ts';

/** Dependencias del módulo. */
export interface FinanceModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Crea el módulo: el servicio del libro y su router (se monta bajo `/api/v1`). */
export function createFinanceModule(deps: FinanceModuleDeps) {
  const ledger = new LedgerService(deps);
  const router = createLedgerRouter(createLedgerController(ledger));
  return { ledger, router };
}
