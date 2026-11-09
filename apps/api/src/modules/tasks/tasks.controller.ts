/**
 * Controladores HTTP de las tareas y del tiempo dedicado: validan la entrada con los esquemas
 * compartidos, llaman al servicio y dan forma a la respuesta. Sin lógica de negocio ni SQL.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  createTaskRequestSchema,
  createTimeEntryRequestSchema,
  listTasksQuerySchema,
  moveTaskRequestSchema,
  updateTaskRequestSchema,
  type MoveTaskResponse,
  type TaskBoardResponse,
  type TaskColumnResponse,
  type TaskResponse,
  type TimeEntryResponse,
} from '@backoffice/shared';
import type { ColumnView, MoveResult, TaskView, TasksService } from './tasks.service.ts';
import type { TimeEntriesService, TimeEntryView } from './time-entries.service.ts';

const idSchema = z.uuid();

export function taskDto(task: TaskView): TaskResponse {
  return {
    id: task.id,
    title: task.title,
    descriptionMd: task.descriptionMd,
    status: task.status,
    position: task.position,
    dueOn: task.dueOn,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    timeSpentSeconds: task.timeSpentSeconds,
    timerStartedAt: task.timerStartedAt?.toISOString() ?? null,
  };
}

function columnDto(column: ColumnView): TaskColumnResponse {
  return { status: column.status, tasks: column.tasks.map(taskDto) };
}

export function boardDto(columns: readonly ColumnView[]): TaskBoardResponse {
  return { columns: columns.map(columnDto) };
}

function moveDto(result: MoveResult): MoveTaskResponse {
  return { task: taskDto(result.task), columns: result.columns.map(columnDto) };
}

export function timeEntryDto(entry: TimeEntryView): TimeEntryResponse {
  return {
    id: entry.id,
    taskId: entry.taskId,
    startedAt: entry.startedAt.toISOString(),
    endedAt: entry.endedAt?.toISOString() ?? null,
    durationSeconds: entry.durationSeconds,
  };
}

/** Un identificador que no es un UUID da 400 (lo convierte el gestor central de errores). */
const idParam = (value: unknown): string => idSchema.parse(value);

export function createTasksController(service: TasksService) {
  const list: RequestHandler = async (req, res) => {
    const { status } = listTasksQuerySchema.parse(req.query);
    res.json(boardDto(await service.board(status)));
  };
  const get: RequestHandler = async (req, res) => {
    res.json(taskDto(await service.get(idParam(req.params['id']))));
  };
  const create: RequestHandler = async (req, res) => {
    res.status(201).json(taskDto(await service.create(createTaskRequestSchema.parse(req.body))));
  };
  const update: RequestHandler = async (req, res) => {
    const input = updateTaskRequestSchema.parse(req.body);
    res.json(taskDto(await service.update(idParam(req.params['id']), input)));
  };
  const remove: RequestHandler = async (req, res) => {
    await service.delete(idParam(req.params['id']));
    res.status(204).end();
  };
  const move: RequestHandler = async (req, res) => {
    const input = moveTaskRequestSchema.parse(req.body);
    res.json(moveDto(await service.move(idParam(req.params['id']), input)));
  };
  return { list, get, create, update, remove, move };
}

export function createTimeEntriesController(service: TimeEntriesService) {
  const list: RequestHandler = async (req, res) => {
    const items = await service.list(idParam(req.params['id']));
    res.json({ items: items.map(timeEntryDto) });
  };
  const addManual: RequestHandler = async (req, res) => {
    const input = createTimeEntryRequestSchema.parse(req.body);
    const entry = await service.addManual(idParam(req.params['id']), input);
    res.status(201).json(timeEntryDto(entry));
  };
  const start: RequestHandler = async (req, res) => {
    res.status(201).json(timeEntryDto(await service.start(idParam(req.params['id']))));
  };
  const stop: RequestHandler = async (req, res) => {
    res.json(timeEntryDto(await service.stop(idParam(req.params['id']))));
  };
  const remove: RequestHandler = async (req, res) => {
    await service.delete(idParam(req.params['id']));
    res.status(204).end();
  };
  return { list, addManual, start, stop, remove };
}
