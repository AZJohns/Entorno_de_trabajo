/**
 * Controlador HTTP del presupuesto: valida la entrada con los esquemas compartidos, llama al servicio y
 * da forma a la respuesta. Sin lógica de negocio ni SQL.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  copyBudgetsRequestSchema,
  createBudgetRequestSchema,
  listBudgetsQuerySchema,
  updateBudgetRequestSchema,
  type BudgetResponse,
} from '@backoffice/shared';
import type { BudgetRecord } from './budget.repository.ts';
import type { BudgetService } from './budget.service.ts';

const idSchema = z.uuid();

export function budgetDto(budget: BudgetRecord): BudgetResponse {
  return {
    id: budget.id,
    month: budget.month.slice(0, 7),
    categoryId: budget.categoryId,
    amountCents: budget.amountCents,
  };
}

export function createBudgetController(service: BudgetService) {
  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(listBudgetsQuerySchema.parse(req.query).month));
  };
  const create: RequestHandler = async (req, res) => {
    const budget = await service.create(createBudgetRequestSchema.parse(req.body));
    res.status(201).json(budgetDto(budget));
  };
  const update: RequestHandler = async (req, res) => {
    const { amountCents } = updateBudgetRequestSchema.parse(req.body);
    // Un identificador que no es un UUID da 400 (lo convierte el gestor central de errores).
    const budget = await service.update(idSchema.parse(req.params['id']), amountCents);
    res.json(budgetDto(budget));
  };
  const remove: RequestHandler = async (req, res) => {
    await service.delete(idSchema.parse(req.params['id']));
    res.status(204).end();
  };
  const copyPrevious: RequestHandler = async (req, res) => {
    const { month } = copyBudgetsRequestSchema.parse(req.body);
    res.json(await service.copyFromPreviousMonth(month));
  };
  return { list, create, update, remove, copyPrevious };
}
