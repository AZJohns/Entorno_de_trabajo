# Política de seguridad

Este repositorio contiene el código de un backoffice **personal y privado** (finanzas, tareas y notas) de un solo usuario. El código es público; la instancia desplegada y sus datos, no.

## Cómo reportar una vulnerabilidad

**No abras una *issue* pública ni un PR** para describir una vulnerabilidad.

Usa el **informe privado de vulnerabilidades de GitHub**: pestaña **Security → Report a vulnerability** de este repositorio. El informe solo lo ve el propietario.

Incluye, si puedes:
- La descripción del problema y su impacto.
- Los pasos para reproducirlo contra una instalación **local** (`docs/plan.md` explica la arquitectura).
- La versión o el commit afectado.

*English: please do not open public issues for security problems. Use GitHub's private vulnerability reporting (Security → Report a vulnerability).*

## Qué puedes esperar

Es un proyecto personal mantenido por una sola persona, así que los plazos son orientativos:

- Acuse de recibo: en un plazo de **7 días**.
- Valoración inicial: en **14 días**.
- Corrección: según la gravedad, con los plazos de `docs/plan.md` §6.2 (crítica 7 días, alta 30, media 90).

No hay programa de recompensas.

## Alcance

- **Dentro**: el código de este repositorio (`apps/`, `packages/`), su configuración de despliegue y los workflows de CI.
- **Fuera**:
  - La instancia en producción: no es pública y **no está autorizado probarla**.
  - Ataques de ingeniería social.
  - Denegación de servicio.
  - Vulnerabilidades de dependencias de terceros que ya tengan un aviso público (repórtalas al proyecto correspondiente).

## Buenas prácticas para quien investiga

Si actúas de buena fe, solo contra tu propia instalación local y reportas por el canal privado, no se emprenderá ninguna acción contra ti. No accedas a datos ajenos, no los modifiques y no los conserves.

## Versiones con soporte

Solo la rama `main`.
