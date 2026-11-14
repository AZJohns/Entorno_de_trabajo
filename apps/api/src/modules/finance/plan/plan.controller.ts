/**
 * Controlador HTTP de la lectura del plan (`GET /plan/*`): valida el mes, el identificador y el rango con
 * los esquemas compartidos, llama al servicio y responde con su resultado. Sin lógica de negocio, sin SQL y
 * sin cálculos: todo lo calculado sale ya hecho de `PlanQueryService`.
 */
import type { RequestHandler } from 'express';
import {
  planMonthParamSchema,
  planSnapshotIdParamSchema,
  planSnapshotsQuerySchema,
} from '@backoffice/shared';
import type { PlanQueryService } from './plan-query.service.ts';

export function createPlanController(service: PlanQueryService) {
  /** `:month` de la URL; si no es `YYYY-MM`, 400 (lo convierte el gestor central de errores). */
  const month = (value: unknown): string => planMonthParamSchema.parse(value);

  const listSnapshots: RequestHandler = async (req, res) => {
    const { from, to } = planSnapshotsQuerySchema.parse(req.query);
    res.json(await service.listSnapshots(from, to));
  };
  const getSnapshot: RequestHandler = async (req, res) => {
    res.json(await service.getSnapshot(planSnapshotIdParamSchema.parse(req.params['id'])));
  };
  const getMonth: RequestHandler = async (req, res) => {
    res.json(await service.getMonth(month(req.params['month'])));
  };
  const budget: RequestHandler = async (req, res) => {
    res.json(await service.budget(month(req.params['month'])));
  };
  const projection: RequestHandler = async (req, res) => {
    res.json(await service.projection(month(req.params['month'])));
  };
  const goals: RequestHandler = async (req, res) => {
    res.json(await service.goals(month(req.params['month'])));
  };
  const scenarios: RequestHandler = async (req, res) => {
    res.json(await service.scenarios(month(req.params['month'])));
  };
  const checks: RequestHandler = async (req, res) => {
    res.json(await service.checks(month(req.params['month'])));
  };
  const dashboard: RequestHandler = async (req, res) => {
    res.json(await service.dashboard(month(req.params['month'])));
  };

  return {
    listSnapshots,
    getSnapshot,
    getMonth,
    budget,
    projection,
    goals,
    scenarios,
    checks,
    dashboard,
  };
}
