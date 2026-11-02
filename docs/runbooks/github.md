# Runbook: configurar GitHub para un repositorio público

> Los pasos de este runbook **los ejecuta el propietario en la web de GitHub**. Las sesiones de Claude no cambian la configuración del repositorio.
> GitHub renombra a menudo las pantallas de configuración. Los nombres de menú son los vigentes en noviembre de 2026 [VERIFICAR]; si no coinciden, busca la opción equivalente.

Orden recomendado: **§1 (antes de publicar) → §2 → §3 → §4 → §5 → §6 → §7 (comprobación)**.

---

## 1. Antes de cambiar la visibilidad a pública

Todo lo que hay en el historial será público y además puede quedar copiado en *forks* y cachés. Después de publicar, borrar algo ya no garantiza nada.

### 1.1 Correos en el historial

- **Situación actual**: el commit inicial (`5110c0a`, «Add initial README with project title») tiene como autor tu **correo personal**. Contradice la regla «sin correos en el repositorio ni en el historial». Los commits hechos por Claude usan `noreply@anthropic.com`.
- **Configura la privacidad del correo** (hazlo en cualquier caso):
  1. Ajustes de tu cuenta → **Emails** → activa **«Keep my email addresses private»** y **«Block command line pushes that expose my email»**.
  2. Copia tu dirección `ID+usuario@users.noreply.github.com`. En cada máquina, ejecuta `git config --global user.email "<esa dirección>"`.
- **Corrige el historial** (decisión tuya; recomendado **ahora**, que solo hay unos pocos commits y el repositorio es privado):
  1. Instala `git-filter-repo` en tu máquina y haz un clon nuevo con `--mirror`.
  2. Crea un archivo `mailmap` con una línea: `Tu Nombre <ID+usuario@users.noreply.github.com> <correo-personal>`.
  3. Ejecuta `git filter-repo --mailmap mailmap` y revisa el resultado con `git log --format='%an <%ae> | %cn <%ce>'`.
  4. Haz *push* forzado de **todas** las ramas (`main` y `claude/*`). **Es destructivo**: se reescriben los identificadores de todos los commits, y cualquier otro clon o PR abierto queda desfasado.
  5. Si no quieres reescribir, la alternativa es **aceptar** que ese correo es público (decisión tuya). La regla rige desde ahora en cualquier caso.

### 1.2 Escaneo de secretos de todo el historial

- Ejecuta gitleaks sobre **todo** el historial, de todas las ramas: `gitleaks git --redact -v .` [VERIFICAR la sintaxis de tu versión; en versiones antiguas, `gitleaks detect`].
- Resultado esperado: **0 hallazgos**.
- Si aparece algo real: **primero rota el secreto** (cámbialo o revócalo en su servicio) y después límpialo del historial. Borrarlo no basta, porque ya pudo copiarse.

### 1.3 Revisión manual

- Revisa cada archivo y cada mensaje de commit buscando: dominios propios, IP, correos, nombres de bancos o de cuentas, nombres de tarjetas, importes reales y capturas.
- Busca también en los documentos de pruebas del dispositivo (`docs/atajo-iphone.md`, cuando exista): solo puede haber recuentos y formatos.

### 1.4 Licencia

- Decide la licencia (`docs/plan.md` §9, pregunta 28; recomendación: MIT) y añade `LICENSE` **antes** de publicar.
- Sin licencia, el código es visible pero no se puede reutilizar legalmente.

### 1.5 Cambiar la visibilidad

Settings → General → *Danger Zone* → **Change repository visibility** → Public.

---

## 2. Secret scanning y *push protection* a nivel de repositorio

Settings → **Advanced Security** (antes, «Code security and analysis»):

1. **Secret Protection / Secret scanning** → *Enable*.
2. **Push protection** → *Enable*.

**Por qué a nivel de repositorio, además de la protección personal**: la *push protection* de tu cuenta (Ajustes personales → Code security) solo te bloquea a ti y, **si la saltas, no genera ninguna alerta**. La del repositorio bloquea a cualquier persona que contribuya, y **cada vez que alguien la salta queda una alerta** en la pestaña *Security*. Activa las dos.

---

## 3. Dependabot e informes privados de vulnerabilidades

Settings → **Advanced Security**:

1. **Dependency graph** → activado (en los repositorios públicos suele venir activado).
2. **Dependabot alerts** → *Enable*.
3. **Dependabot security updates** → *Enable*: abre PR automáticos para las dependencias vulnerables.
4. **Grouped security updates** → opcional; reduce el número de PR.
5. **Private vulnerability reporting** → *Enable*. **Es obligatorio**: `SECURITY.md` remite a este canal.

Las actualizaciones de versión (no solo las de seguridad) se configuran en la fase 0 con `.github/dependabot.yml` (npm, GitHub Actions y Docker).

---

## 4. Code scanning (CodeQL)

Settings → **Advanced Security** → **Code scanning** → *CodeQL analysis* → **Set up → Default**.

- Lenguajes: JavaScript/TypeScript y GitHub Actions.
- En los repositorios públicos es gratuito.
- Los avisos aparecen en *Security → Code scanning*. Se tratan con los mismos plazos que las dependencias (`plan.md` §6.2).

---

## 5. Regla que protege `main`

Settings → **Rules → Rulesets → New ruleset → New branch ruleset**:

| Campo | Valor |
|---|---|
| Ruleset name | `main` |
| Enforcement status | **Active** |
| Bypass list | **Vacía** (ni siquiera tú: si alguna vez hace falta saltarla, se edita la regla de forma consciente y queda registrado) |
| Target branches | *Include default branch* |
| Restrict deletions | ✔ |
| Block force pushes | ✔ |
| Require a pull request before merging | ✔. **Required approvals: 0**: GitHub no deja aprobar un PR propio y eres el único desarrollador. El valor está en obligar a pasar por PR y por la CI |
| Require status checks to pass | ✔. Añade los *jobs* de la CI: `lint`, `typecheck`, `test`, `build` y `gitleaks`. Solo aparecen después de la primera ejecución de la CI, así que este paso se completa en la fase 0, cuando ya exista el workflow |
| Require branches to be up to date before merging | Opcional (recomendado) |
| Require code scanning results | Opcional: CodeQL sin alertas altas o críticas |

Proteger ramas solo es posible en los repositorios privados con un plan de pago. Por eso, al hacer el repositorio **público**, este paso pasa a estar disponible.

---

## 6. GitHub Actions y otros ajustes

Settings → **Actions → General**:

1. **Actions permissions** → *Allow \<tu usuario\>, and select non-\<tu usuario\>, actions and reusable workflows*. Permite las de GitHub y las de creadores verificados. Fija siempre las acciones de terceros por **SHA de commit**.
2. **Fork pull request workflows from outside collaborators** → *Require approval for all external contributors*.
3. **Workflow permissions** → **Read repository contents and packages permissions**, y desactiva *Allow GitHub Actions to create and approve pull requests*.

Además:

- Settings → General → **Automatically delete head branches** ✔.
- Desactiva *Wikis*, *Projects* y *Discussions* si no los vas a usar: menos superficie.
- **Nunca** uses `pull_request_target` con *checkout* del código del PR, ni secretos en workflows que se ejecuten con código de terceros.

---

## 7. Comprobación final (marca cada casilla)

- [ ] El historial no contiene tu correo personal, o has aceptado explícitamente que sea público (§1.1).
- [ ] gitleaks sobre todo el historial: 0 hallazgos (§1.2).
- [ ] Revisión manual hecha (§1.3).
- [ ] `LICENSE` presente (§1.4).
- [ ] Secret scanning y *push protection* del **repositorio** activos (§2). Prueba: en una rama desechable, sube un secreto **falso** con el formato de un proveedor conocido; tiene que bloquearse. Borra la rama después.
- [ ] Dependabot (alertas y actualizaciones de seguridad) e informes privados de vulnerabilidades activos (§3).
- [ ] CodeQL (configuración por defecto) activo y con un primer análisis completado (§4).
- [ ] Regla `main` activa: un PR con la CI en rojo no se puede fusionar y un *push* directo a `main` se rechaza (§5).
- [ ] Permisos de Actions restringidos (§6).

## 8. Si se filtra un secreto (en cualquier momento)

1. **Rotarlo de inmediato** en su servicio (revocar el token, cambiar la clave, regenerar las claves VAPID…).
2. Revisar los logs del servicio afectado por si hubo uso indebido.
3. Limpiar el historial si procede (`git filter-repo`) y cerrar la alerta indicando que el secreto se ha rotado.
4. Anotar el incidente (sin el secreto) en `docs/runbooks/incidentes.md`.
