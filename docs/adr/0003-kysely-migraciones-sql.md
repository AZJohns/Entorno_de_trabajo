# ADR 0003 — Kysely y migraciones SQL versionadas e inmutables

- **Estado:** Aceptado
- **Fecha:** 2026-11-02

## Contexto

El modelo de datos se apoya en características de PostgreSQL que un ORM suele esconder o no soporta bien:
- `CHECK`, claves ajenas compuestas e índices únicos parciales;
- restricciones diferibles;
- `tsvector` y columnas generadas.

Las reglas de negocio importantes deben estar **también** en la base de datos. Hay que poder explicar cada consulta.

## Decisión

1. **Kysely** (constructor de consultas tipado) con el driver **pg**. Las consultas se parecen al SQL que generan y no hay un ORM ni objetos con estado.
   - En la versión 0.29, el migrador se importa de `kysely/migration`.
2. **Migraciones con el `Migrator` de Kysely**, escritas en TypeScript con SQL explícito (`sql\`…\``):
   - Están en `apps/api/src/db/migrations/` y se nombran `NNNN_descripcion.ts` con un número de 4 cifras. Con un único desarrollador no hay migraciones paralelas, y un número correlativo se lee mejor que una marca de tiempo.
   - Se aplican con `pnpm db:migrate`. Kysely registra las aplicadas en la tabla `kysely_migration`.
3. **Una migración aplicada o publicada en `main` no se edita nunca: se crea otra nueva.**
   - Lo comprueba la CI (`apps/api/scripts/check-migrations-immutable.ts`): solo se permite **añadir** archivos en esa carpeta.
   - Kysely no guarda checksums de las migraciones aplicadas, así que sin esta comprobación una edición pasaría desapercibida.
4. **Solo hacia delante en producción.** `down` existe solo si es trivial y sirve para el desarrollo local. Los cambios destructivos siguen el patrón *expand/contract* (añadir, migrar los datos y eliminar en un despliegue posterior).
5. **Tipos**: en la fase 1, con las primeras tablas, se generarán desde la base de datos real con `kysely-codegen`. La base de datos es la fuente de verdad. Hoy la interfaz `Database` está vacía.
6. **Versión de PostgreSQL**: la referencia es la 18 (CI y `compose.yaml`, imagen fijada por *digest*). Mientras no se diga lo contrario en la migración, solo se usan funciones disponibles desde la 13. La primera migración (`unaccent`, `es_unaccent`) cumple esa regla.

## Alternativas descartadas

- **Prisma**: buena experiencia de desarrollo, pero `tsvector` no está soportado, los `CHECK` se escriben a mano y su DSL esconde el SQL.
- **Drizzle**: el esquema en TypeScript da tipos sin generar código, pero su versión 1.0 seguía en *release candidate* en noviembre de 2026. Se puede reconsiderar cuando sea estable.
- **TypeORM**: decoradores y un mantenimiento irregular.
- **node-pg-migrate + SQL sin constructor de consultas**: sería una dependencia más para migrar y no daría consultas tipadas.
- **Migraciones con marca de tiempo**: útiles con varios desarrolladores; aquí basta un número correlativo.

## Consecuencias

- Hay que escribir SQL: es un objetivo de aprendizaje, no un coste.
- Los tests de integración usan un PostgreSQL real: en local con `compose.yaml` y en la CI como servicio. Cada ejecución crea una base de datos temporal y la borra al terminar.
- Corregir una migración ya publicada exige una migración nueva.
