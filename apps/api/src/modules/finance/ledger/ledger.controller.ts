/**
 * Controladores HTTP del libro real: validan la entrada con los esquemas compartidos, llaman al
 * servicio y dan forma a la respuesta. Sin lógica de negocio ni SQL.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  createAccountRequestSchema,
  createCategoryRequestSchema,
  createMovementRequestSchema,
  createReconciliationRequestSchema,
  createTransferRequestSchema,
  listArchivableQuerySchema,
  listMovementsQuerySchema,
  listTransfersQuerySchema,
  updateAccountRequestSchema,
  updateCategoryRequestSchema,
  updateMovementRequestSchema,
  updateTransferRequestSchema,
  type AccountResponse,
  type CategoryResponse,
  type CreateReconciliationResponse,
  type MovementResponse,
  type ReconciliationResponse,
  type TransferResponse,
} from '@backoffice/shared';
import type { CategoryRecord, MovementRecord, TransferRecord } from './ledger.repository.ts';
import type { AccountView, LedgerService, ReconciliationView } from './ledger.service.ts';

const idSchema = z.uuid();

function accountDto(account: AccountView): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: 'EUR',
    openingBalanceCents: account.openingBalanceCents,
    openingDate: account.openingDate,
    balanceCents: account.balanceCents,
    archived: account.archivedAt !== null,
  };
}

function categoryDto(category: CategoryRecord): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    kind: category.kind,
    archived: category.archivedAt !== null,
  };
}

function movementDto(movement: MovementRecord): MovementResponse {
  return {
    id: movement.id,
    kind: movement.kind,
    amountCents: movement.amountCents,
    description: movement.description,
    merchant: movement.merchant,
    accountId: movement.accountId,
    categoryId: movement.categoryId,
    bookedOn: movement.bookedOn,
    source: movement.source,
    reconciliationId: movement.reconciliationId,
    status: movement.status,
    flags: [...movement.flags],
    createdAt: movement.createdAt.toISOString(),
    confirmedAt: movement.confirmedAt?.toISOString() ?? null,
  };
}

function transferDto(transfer: TransferRecord): TransferResponse {
  return {
    id: transfer.id,
    fromAccountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    amountCents: transfer.amountCents,
    bookedOn: transfer.bookedOn,
    note: transfer.note,
    createdAt: transfer.createdAt.toISOString(),
  };
}

function reconciliationDto(view: ReconciliationView): ReconciliationResponse {
  return {
    id: view.id,
    accountId: view.accountId,
    month: view.month.slice(0, 7),
    asOf: view.asOf,
    statementBalanceCents: view.statementBalanceCents,
    computedBalanceCents: view.computedBalanceCents,
    note: view.note,
    createdAt: view.createdAt.toISOString(),
    adjustmentMovementId: view.adjustmentMovementId,
    discrepancy: view.discrepancy,
  };
}

export function createLedgerController(service: LedgerService) {
  /** Identificador de la URL; si no es un UUID, 400 (lo convierte el gestor central de errores). */
  const idParam = (value: unknown): string => idSchema.parse(value);

  // --- cuentas ---
  const listAccounts: RequestHandler = async (req, res) => {
    const { includeArchived } = listArchivableQuerySchema.parse(req.query);
    res.json({ items: (await service.listAccounts(includeArchived)).map(accountDto) });
  };
  const createAccount: RequestHandler = async (req, res) => {
    const account = await service.createAccount(createAccountRequestSchema.parse(req.body));
    res.status(201).json(accountDto(account));
  };
  const getAccount: RequestHandler = async (req, res) => {
    res.json(accountDto(await service.getAccount(idParam(req.params['id']))));
  };
  const updateAccount: RequestHandler = async (req, res) => {
    const account = await service.updateAccount(
      idParam(req.params['id']),
      updateAccountRequestSchema.parse(req.body),
    );
    res.json(accountDto(account));
  };
  const archiveAccount: RequestHandler = async (req, res) => {
    res.json(accountDto(await service.archiveAccount(idParam(req.params['id']))));
  };

  // --- categorías ---
  const listCategories: RequestHandler = async (req, res) => {
    const { includeArchived } = listArchivableQuerySchema.parse(req.query);
    res.json({ items: (await service.listCategories(includeArchived)).map(categoryDto) });
  };
  const createCategory: RequestHandler = async (req, res) => {
    const category = await service.createCategory(createCategoryRequestSchema.parse(req.body));
    res.status(201).json(categoryDto(category));
  };
  const renameCategory: RequestHandler = async (req, res) => {
    const { name } = updateCategoryRequestSchema.parse(req.body);
    res.json(categoryDto(await service.renameCategory(idParam(req.params['id']), name)));
  };
  const archiveCategory: RequestHandler = async (req, res) => {
    res.json(categoryDto(await service.archiveCategory(idParam(req.params['id']))));
  };

  // --- movimientos ---
  const listMovements: RequestHandler = async (req, res) => {
    const page = await service.listMovements(listMovementsQuerySchema.parse(req.query));
    res.json({ items: page.items.map(movementDto), nextCursor: page.nextCursor });
  };
  const pendingCount: RequestHandler = async (_req, res) => {
    res.json({ count: await service.pendingCount() });
  };
  const createMovement: RequestHandler = async (req, res) => {
    const movement = await service.createMovement(createMovementRequestSchema.parse(req.body));
    res.status(201).json(movementDto(movement));
  };
  const getMovement: RequestHandler = async (req, res) => {
    res.json(movementDto(await service.getMovement(idParam(req.params['id']))));
  };
  const updateMovement: RequestHandler = async (req, res) => {
    const movement = await service.updateMovement(
      idParam(req.params['id']),
      updateMovementRequestSchema.parse(req.body),
    );
    res.json(movementDto(movement));
  };
  const confirmMovement: RequestHandler = async (req, res) => {
    res.json(movementDto(await service.confirmMovement(idParam(req.params['id']))));
  };
  const deleteMovement: RequestHandler = async (req, res) => {
    await service.deleteMovement(idParam(req.params['id']));
    res.status(204).end();
  };

  // --- transferencias ---
  const listTransfers: RequestHandler = async (req, res) => {
    const page = await service.listTransfers(listTransfersQuerySchema.parse(req.query));
    res.json({ items: page.items.map(transferDto), nextCursor: page.nextCursor });
  };
  const createTransfer: RequestHandler = async (req, res) => {
    const transfer = await service.createTransfer(createTransferRequestSchema.parse(req.body));
    res.status(201).json(transferDto(transfer));
  };
  const getTransfer: RequestHandler = async (req, res) => {
    res.json(transferDto(await service.getTransfer(idParam(req.params['id']))));
  };
  const updateTransfer: RequestHandler = async (req, res) => {
    const transfer = await service.updateTransfer(
      idParam(req.params['id']),
      updateTransferRequestSchema.parse(req.body),
    );
    res.json(transferDto(transfer));
  };
  const deleteTransfer: RequestHandler = async (req, res) => {
    await service.deleteTransfer(idParam(req.params['id']));
    res.status(204).end();
  };

  // --- conciliaciones ---
  const listReconciliations: RequestHandler = async (req, res) => {
    const views = await service.listReconciliations(idParam(req.params['id']));
    res.json({ items: views.map(reconciliationDto) });
  };
  const createReconciliation: RequestHandler = async (req, res) => {
    const outcome = await service.reconcileAccount(
      idParam(req.params['id']),
      createReconciliationRequestSchema.parse(req.body),
    );
    const body: CreateReconciliationResponse = {
      id: outcome.id,
      computedBalanceCents: outcome.computedBalanceCents,
      differenceCents: outcome.differenceCents,
      ...(outcome.adjustmentMovementId === undefined
        ? {}
        : { adjustmentMovementId: outcome.adjustmentMovementId }),
    };
    res.status(201).json(body);
  };
  const deleteReconciliation: RequestHandler = async (req, res) => {
    await service.deleteReconciliation(idParam(req.params['id']));
    res.status(204).end();
  };

  return {
    listAccounts,
    createAccount,
    getAccount,
    updateAccount,
    archiveAccount,
    listCategories,
    createCategory,
    renameCategory,
    archiveCategory,
    listMovements,
    pendingCount,
    createMovement,
    getMovement,
    updateMovement,
    confirmMovement,
    deleteMovement,
    listTransfers,
    createTransfer,
    getTransfer,
    updateTransfer,
    deleteTransfer,
    listReconciliations,
    createReconciliation,
    deleteReconciliation,
  };
}
