/**
 * Esquemas de las tareas y del tiempo dedicado, compartidos por la web y la API (docs/plan.md §2.6 y
 * §2.10). Mismas convenciones que el libro: peticiones estrictas (un campo desconocido es un error),
 * fechas `YYYY-MM-DD` e instantes en ISO 8601. Las reglas que dependen de otras filas o del reloj (la
 * tarea existe, el intervalo no acaba en el futuro, no hay solapes…) las comprueba el servicio.
 */
import { z } from 'zod';
import { localDateSchema } from '../finance/schemas.ts';

/** Columnas del tablero, en el orden en que se muestran. */
export const TASK_STATUSES = ['todo', 'in_progress', 'testing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);

/**
 * Tope de una anotación manual (7 días). Evita que un error al teclear (`durationSeconds` enorme)
 * desborde el `Date` de JavaScript. El cronómetro no lo tiene: registra lo que ha pasado.
 */
export const MAX_MANUAL_ENTRY_SECONDS = 7 * 24 * 60 * 60;

const title = z.string().trim().min(1).max(200);
/** Texto libre opcional: el texto vacío equivale a «sin valor». */
const description = z
  .string()
  .trim()
  .max(10_000)
  .nullable()
  .transform((value) => (value === '' ? null : value));

/** Instante ISO 8601 con zona (`Z` o desplazamiento), a partir de 1970: PostgreSQL no admite el año 0000. */
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) >= 0, { message: 'Fecha no válida' });

// --- tareas --------------------------------------------------------------------------------------

/** Alta: la tarea se añade al final de la columna (por defecto, «Por hacer»). */
export const createTaskRequestSchema = z.strictObject({
  title,
  descriptionMd: description.optional(),
  dueOn: localDateSchema.nullable().optional(),
  status: taskStatusSchema.default('todo'),
});

/**
 * Edición parcial. La columna y la posición no se editan aquí: se mueven con `/move`, que es la única
 * operación que reordena.
 */
export const updateTaskRequestSchema = z
  .strictObject({
    title: title.optional(),
    descriptionMd: description.optional(),
    dueOn: localDateSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Indica al menos un campo',
  });

/** `?status=` de la lista del tablero: sin él, se devuelven las cuatro columnas. */
export const listTasksQuerySchema = z.strictObject({ status: taskStatusSchema.optional() });

/**
 * Mover una tarea a una columna: delante de `beforeId`, detrás de `afterId` o, sin ninguno, al final.
 * Se admite uno solo de los dos: con ambos podrían contradecirse.
 */
export const moveTaskRequestSchema = z
  .strictObject({
    status: taskStatusSchema,
    beforeId: z.uuid().optional(),
    afterId: z.uuid().optional(),
  })
  .refine((value) => value.beforeId === undefined || value.afterId === undefined, {
    message: 'Indica beforeId o afterId, no los dos',
    path: ['afterId'],
  });

const taskTimestamp = z.iso.datetime();

export const taskResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  descriptionMd: z.string().nullable(),
  status: taskStatusSchema,
  /** Lugar en la columna, de 0 a n−1 sin huecos. */
  position: z.int().min(0),
  dueOn: localDateSchema.nullable(),
  completedAt: taskTimestamp.nullable(),
  createdAt: taskTimestamp,
  updatedAt: taskTimestamp,
  /** Tiempo dedicado en segundos, calculado al leer. Si el cronómetro está en marcha, cuenta hasta ahora. */
  timeSpentSeconds: z.int().min(0),
  /** Inicio del cronómetro en marcha de esta tarea, o `null`. La web lo usa para mostrar el contador. */
  timerStartedAt: taskTimestamp.nullable(),
});

export const taskColumnResponseSchema = z.object({
  status: taskStatusSchema,
  /** Ordenadas por posición. */
  tasks: z.array(taskResponseSchema),
});

/** El tablero: las cuatro columnas en orden o, con `?status=`, solo la pedida. */
export const taskBoardResponseSchema = z.object({ columns: z.array(taskColumnResponseSchema) });

/** Resultado de mover: la tarea y el nuevo orden de las columnas afectadas (una o dos). */
export const moveTaskResponseSchema = z.object({
  task: taskResponseSchema,
  columns: z.array(taskColumnResponseSchema).min(1).max(2),
});

// --- tiempo dedicado -----------------------------------------------------------------------------

/**
 * Anotación manual: inicio y fin, o inicio y duración (se convierte en fin). Se guarda siempre como
 * intervalo.
 */
export const createTimeEntryRequestSchema = z
  .strictObject({
    startedAt: instant,
    endedAt: instant.optional(),
    durationSeconds: z.int().positive().optional(),
  })
  .refine((value) => (value.endedAt === undefined) !== (value.durationSeconds === undefined), {
    message: 'Indica endedAt o durationSeconds, uno de los dos',
    path: ['endedAt'],
  })
  // Se comparan instantes y no textos: «10:00+02:00» es anterior a «09:00Z» aunque el texto diga otra cosa.
  .refine(
    (value) =>
      value.endedAt === undefined || Date.parse(value.endedAt) > Date.parse(value.startedAt),
    { message: 'El fin debe ser posterior al inicio', path: ['endedAt'] },
  )
  .refine(
    (value) => {
      const seconds =
        value.durationSeconds ??
        (value.endedAt === undefined
          ? 0
          : (Date.parse(value.endedAt) - Date.parse(value.startedAt)) / 1000);
      return seconds <= MAX_MANUAL_ENTRY_SECONDS;
    },
    { message: 'Una anotación manual no puede durar más de 7 días', path: ['durationSeconds'] },
  );

export const timeEntryResponseSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  startedAt: taskTimestamp,
  /** `null` mientras el cronómetro está en marcha. */
  endedAt: taskTimestamp.nullable(),
  /** Duración en segundos; si está en marcha, hasta ahora. */
  durationSeconds: z.int().min(0),
});

export const timeEntryListResponseSchema = z.object({ items: z.array(timeEntryResponseSchema) });

// --- recordatorios -------------------------------------------------------------------------------

/** Zona horaria en la que se escriben y se muestran los recordatorios (docs/plan.md §1.3: Europe/Madrid). */
export const REMINDER_TIME_ZONE = 'Europe/Madrid';

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Indica si el texto es una fecha y hora locales `YYYY-MM-DDTHH:mm` que existe en el calendario (sin
 * 30 de febrero ni 24:00), a partir de 1970. NO mira la zona: que esa hora exista o no en Madrid (cambio
 * de horario) lo decide la API al convertirla.
 */
export function isLocalDateTime(value: string): boolean {
  const match = LOCAL_DATE_TIME.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1970) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute
  );
}

/**
 * Alta de un recordatorio: fecha y hora **locales de Madrid**, sin zona ni desplazamiento. La API la
 * convierte en un instante; así hay un único sitio con la regla de los cambios de horario.
 */
export const createReminderRequestSchema = z.strictObject({
  remindAtLocal: z.string().refine(isLocalDateTime, { message: 'Fecha y hora no válidas' }),
});

export const reminderResponseSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  /** El instante del aviso en ISO 8601 (UTC). La web lo muestra en la hora de Madrid. */
  remindAt: taskTimestamp,
  /** Cuándo se entregó, o `null` si sigue pendiente. */
  sentAt: taskTimestamp.nullable(),
});

export const reminderListResponseSchema = z.object({ items: z.array(reminderResponseSchema) });

export type CreateReminderRequest = z.infer<typeof createReminderRequestSchema>;
export type ReminderResponse = z.infer<typeof reminderResponseSchema>;
export type ReminderListResponse = z.infer<typeof reminderListResponseSchema>;

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type TaskColumnResponse = z.infer<typeof taskColumnResponseSchema>;
export type TaskBoardResponse = z.infer<typeof taskBoardResponseSchema>;
export type MoveTaskResponse = z.infer<typeof moveTaskResponseSchema>;
export type CreateTimeEntryRequest = z.infer<typeof createTimeEntryRequestSchema>;
export type TimeEntryResponse = z.infer<typeof timeEntryResponseSchema>;
export type TimeEntryListResponse = z.infer<typeof timeEntryListResponseSchema>;
