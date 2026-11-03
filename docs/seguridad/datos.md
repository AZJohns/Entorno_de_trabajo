# Datos: clasificación, protección y retención

> ASVS 14.1.1 y 14.1.2. **Documento parcial:** hoy solo contiene la **retención** (pregunta 35 de `docs/plan.md`). La clasificación de los datos por nivel y su protección (14.1.1 y 14.1.2) siguen pendientes de la fase 1. Este documento **no contiene datos reales**.

## Retención

| Dato | Retención | Estado |
|---|---|---|
| `audit_events` | 1 año | Hoy no se borra nada. La limpieza automática se implementa en la **fase 2** |
| Sesiones caducadas (`sessions`) | 30 días desde la caducidad | Hoy no se borran. La limpieza automática se implementa en la **fase 2** |
| Logs técnicos | 30 días (y en las copias según su retención, `docs/plan.md` §6.3) | Fase 2, con los destinos de producción |

- **Atención al borrado de `audit_events`:** un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE` (migración `0002_auth`). La purga de la fase 2 necesita un camino explícito y separado del rol de la aplicación; se decide con los roles de la base de datos (ASVS 16.4.2).
