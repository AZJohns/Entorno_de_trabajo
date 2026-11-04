# Runbook: servidor de producción (fase 2)

> Guía paso a paso para el **propietario**, que trabaja en **Windows**. Las sesiones de Claude no tocan la cuenta de AWS, el dominio ni Cloudflare.
> Decisiones que aplica (`docs/plan.md` §7.5–§7.8): **AWS Lightsail** (región de la UE, plan de 2 GB con IPv4), **opción D** (nada público, todo por Tailscale), **dominio propio** con el DNS en Cloudflare y certificado por **DNS-01**.
> **Sin datos reales en este documento.** Los valores que dependen de ti van entre `<ángulos>`. Nunca los escribas en el repositorio (público): ni el dominio, ni las IP, ni los tokens, ni el correo de la cuenta de AWS.
> Las pantallas de AWS, Cloudflare, Tailscale y el registrador cambian a menudo. Los nombres de menú son los de noviembre de 2026 según la documentación de cada servicio; lo que dependa de ellos lleva **[VERIFICAR]**: si no coincide, busca la opción equivalente.

Orden: **§0 → §1 → §2 → §3 → §4 → §5 → §6 → §7 → §8 → §9 → §10**. Salvo la §1 (cuenta de AWS) y la §2 (crear la instancia), que dependen del proveedor, todo lo demás vale para cualquier VPS con Ubuntu. Si algún día cambias de proveedor, solo cambian esas dos secciones.

**Regla de oro del orden**: nunca cierres el acceso público (puerto 22 de Lightsail) **antes** de haber comprobado que entras por Tailscale (§4). Si te equivocas, la recuperación está en la §10.

---

## 0. Antes de empezar

### 0.1 Lo que necesitas

- Un **gestor de contraseñas** con copia de seguridad (todas las contraseñas y claves de este runbook van ahí, nunca en el repositorio).
- Una **tarjeta de pago** para AWS y un **teléfono** para verificar la cuenta [VERIFICAR: AWS puede pedir más datos fiscales según el país].
- **Dos formas de segundo factor** para cada cuenta importante (AWS, Cloudflare, registrador, Tailscale): una aplicación de autenticación o clave de acceso (*passkey*) y otra de respaldo guardada aparte.
- Windows con **PowerShell** y el **cliente OpenSSH** (viene instalado en Windows 10/11; comprueba con `ssh -V`). Te recomiendo **Windows Terminal**.
- Un correo **solo para estas cuentas** (AWS, dominio, Cloudflare): si lo pierdes o te lo comprometen, pierdes todo lo demás.

### 0.2 Lo que NUNCA va al repositorio

| Dato | Dónde vive |
|---|---|
| Contraseña y códigos MFA de la cuenta raíz de AWS | Gestor de contraseñas + copia en papel fuera de línea |
| Clave privada SSH | Solo en tu PC (`~\.ssh`), con frase de paso |
| Dominio real, nombre de la *tailnet*, IP de Tailscale, IP pública del servidor | Solo en tus notas privadas; en el servidor, `PUBLIC_ORIGIN` en el archivo de entorno |
| Token de la API de Cloudflare | Archivo de entorno del servidor con permisos `600` + gestor de contraseñas |
| Clave de autenticación de Tailscale (*auth key*) | Se usa una vez y caduca; no se guarda |
| Contraseña de restic, `TOTP_ENCRYPTION_KEY`, contraseña de PostgreSQL | Gestor + copia en papel (`plan.md` §6.3) |

### 0.3 Nombres que usaré como ejemplo

`<TU_DOMINIO>` (el que compres), `<SUBDOMINIO>` (p. ej., el nombre de la app), `<IP_TAILSCALE_SERVIDOR>` (empieza por `100.`), `<NOMBRE_SERVIDOR>` (el nombre del equipo en Tailscale), `<USUARIO_IAM>`.

---

## 1. Cuenta de AWS y su seguridad  *(sección específica de AWS)*

> La cuenta de AWS es el punto débil de esta arquitectura: quien la controle puede **copiar una instantánea del disco**, abrir el cortafuegos o borrar el servidor (ver `plan.md` §7.8). Dedica el tiempo que haga falta a esta sección **antes** de crear nada.

### 1.1 Crear la cuenta

1. Entra en la página de registro de AWS y crea la cuenta con el **correo exclusivo** de §0.1. Elige un nombre de cuenta que no revele tu identidad ni el proyecto.
2. Contraseña larga y aleatoria, generada por el gestor.
3. Tipo de cuenta: **personal**. Rellena los datos de contacto y de pago. La verificación por teléfono y por tarjeta es normal [VERIFICAR].
4. Plan de soporte: **Basic (gratuito)**.
5. Anota que existe un periodo de prueba gratuita para cuentas nuevas y para Lightsail: **no cuentes con él**. Su duración y condiciones no están comprobadas [VERIFICAR] y el coste de `plan.md` §7.7 es el de lista, sin promociones.

### 1.2 MFA en la cuenta raíz (lo primero, antes de crear nada más)

1. Inicia sesión como **usuario raíz** → menú de tu cuenta (arriba a la derecha) → **Security credentials** [VERIFICAR el nombre].
2. **Multi-factor authentication (MFA)** → *Assign MFA device*.
3. Registra **dos** dispositivos MFA, de tipos distintos si puedes: una **clave de acceso (passkey) o llave de seguridad** y una **aplicación de autenticación** (TOTP). AWS permite varios dispositivos MFA por usuario [VERIFICAR el número máximo].
4. Guarda en el gestor los códigos de configuración y haz una copia en papel de la semilla de la aplicación de autenticación.
5. Cierra sesión y vuelve a entrar para comprobar que el segundo factor funciona.
6. **No crees claves de acceso (*access keys*) para la raíz.** Si ves alguna en la lista, bórrala.

### 1.3 Un usuario propio para el día a día (la raíz deja de usarse)

La raíz solo se usa para lo que **solo ella** puede hacer (activar el acceso de los usuarios a la facturación, cambiar el plan, cerrar la cuenta).

1. Primero, como raíz: Cuenta (*Account*) → **IAM user and role access to Billing information** → *Activate*, para que tu usuario vea los costes [VERIFICAR el nombre].
2. Crea tu usuario. Dos caminos [VERIFICAR cuál recomienda AWS en este momento]:
   - **Más sencillo**: IAM → *Users* → *Create user* `<USUARIO_IAM>` con acceso a la consola, **sin claves de acceso**. Asócialo a la política administrada de Lightsail (`AmazonLightsailFullAccess`) y a los permisos de facturación y presupuestos que necesites.
   - **Más moderno**: IAM Identity Center, que da un inicio de sesión con *passkey* y credenciales temporales. Añade pasos (habilita AWS Organizations).
3. Activa en ese usuario **MFA** (passkey o aplicación; mismo procedimiento que §1.2).
4. Cierra la sesión de la raíz. **A partir de ahora entras siempre con `<USUARIO_IAM>`.**
5. Política de contraseñas de IAM: longitud mínima alta (IAM → *Account settings* → *Password policy*) [VERIFICAR].

### 1.4 Alerta de presupuesto

1. Como `<USUARIO_IAM>` (o como raíz si aún no tiene permisos): **Billing and Cost Management** → **Budgets** → *Create budget* [VERIFICAR].
2. Tipo **Cost budget**, mensual, importe fijo. Sugerencia: **20 USD**, alrededor de 1,7 veces el plan elegido (12 USD).
3. Alertas por correo a tu correo exclusivo:
   - 80 % del gasto **real**.
   - 100 % del gasto **previsto** (*forecasted*).
4. Activa también **Free Tier / alertas de uso** y, si está disponible, **Cost Anomaly Detection** [VERIFICAR].
5. **Una alerta no corta el gasto**: solo avisa. Por eso la §1.3 y el MFA importan más.

### 1.5 Región de la UE

Lightsail muestra un selector de **región** en la consola. Para esta app:

- Elige una región **de la UE** (por ejemplo, Fráncfort o Irlanda) [VERIFICAR cuáles ofrece Lightsail hoy; no todas las regiones de AWS están en Lightsail].
- Los datos de las instancias y de las instantáneas se quedan en la región elegida. Las copias de restic van cifradas en el cliente (`plan.md` §6.3), así que su ubicación importa menos, pero la instancia sí debe estar en la UE.
- Comprueba la región **cada vez** que entres en la consola: crear una instancia en otra región por error es fácil.

### 1.6 Comprobación de la cuenta

- [ ] MFA en la raíz con dos dispositivos y sin claves de acceso.
- [ ] `<USUARIO_IAM>` con MFA y sin claves de acceso.
- [ ] Presupuesto creado y alerta de prueba recibida.
- [ ] Región de la UE seleccionada.
- [ ] Contraseñas y códigos de recuperación guardados (gestor y papel).

---

## 2. Crear la instancia  *(sección específica de AWS Lightsail)*

### 2.1 Clave SSH (en tu PC, PowerShell)

```powershell
# Clave Ed25519 con frase de paso (te la pedirá dos veces). No la subas a ningún sitio.
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\backoffice_prod" -C "backoffice-prod"
Get-Content "$env:USERPROFILE\.ssh\backoffice_prod.pub"
```

La segunda orden muestra la **clave pública** (una línea que empieza por `ssh-ed25519`). La privada (sin `.pub`) no sale de tu PC.

Para no escribir la frase cada vez, abre PowerShell **como administrador** una vez:

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
```

y luego, en tu PowerShell normal: `ssh-add "$env:USERPROFILE\.ssh\backoffice_prod"`.

### 2.2 Crear la instancia

En la consola de Lightsail (región de la UE, §1.5) → *Create instance* [VERIFICAR el flujo]:

1. **Ubicación**: la región de la UE y una zona de disponibilidad.
2. **Plataforma**: Linux/Unix. **Blueprint**: *OS Only* → la **última versión LTS de Ubuntu** que ofrezca [VERIFICAR cuál].
3. **Clave SSH**: sube **tu clave pública** (§2.1) en lugar de usar la clave por defecto de Lightsail [VERIFICAR que se pueda elegir al crear la instancia; si no, cámbiala justo después de crearla].
4. **Plan**: Linux **con IPv4**, **2 GB de RAM** (12 USD/mes según la página oficial a 2026-11-04, `plan.md` §7.7).
5. **Nombre**: algo neutro, p. ej., `backoffice-prod`.
6. No uses el *launch script* ni activadores de aplicaciones.
7. *Create instance*. Anota la **IP pública** solo en tus notas privadas: la necesitarás un momento para el primer acceso y para la recuperación (§10).

### 2.3 Cortafuegos de Lightsail (lo cierras más tarde, en §6)

Por defecto Lightsail abre **22 (SSH)** y **80 (HTTP)** para Linux, tanto en IPv4 como en IPv6 [VERIFICAR]. Hoy déjalo como está **solo** para entrar la primera vez. Luego, en §6, se queda **sin ninguna regla de entrada**.

---

## 3. Primer acceso y endurecimiento básico

> Todo este bloque se hace por SSH contra la IP pública, **una sola vez**. Termina con el servidor accesible solo por Tailscale (§4 y §6).

### 3.1 Entrar

```powershell
ssh -i "$env:USERPROFILE\.ssh\backoffice_prod" ubuntu@<IP_PUBLICA_TEMPORAL>
```

El usuario por defecto de las imágenes de Ubuntu en Lightsail es `ubuntu` [VERIFICAR]. La primera vez te pide confirmar la huella del servidor: compárala con la que muestra la consola de Lightsail si la ofrece.

### 3.2 Actualizar y fijar la zona horaria

```bash
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone UTC     # los logs van en UTC (plan.md §6.2)
sudo reboot                           # si se actualizó el núcleo; vuelve a entrar al minuto
```

### 3.3 `sudo` con contraseña

Por defecto `ubuntu` usa `sudo` sin contraseña. Con la contraseña exigida, una clave SSH robada o un agente secuestrado no sube a administrador sin más.

```bash
sudo passwd ubuntu                                 # contraseña larga; al gestor. Solo sirve para sudo
sudo cat /etc/sudoers.d/90-cloud-init-users        # comprueba qué contiene antes de tocarlo
```

Abre **una segunda sesión SSH** y déjala abierta como seguro. En la primera:

```bash
sudo rm /etc/sudoers.d/90-cloud-init-users         # quita el NOPASSWD
sudo -k && sudo true                               # debe pedir la contraseña
```

Si algo falla, la segunda sesión (ya con privilegios) te permite arreglarlo. El automatismo de despliegue futuro usará **otro usuario sin `sudo`**, no este.

### 3.4 Endurecer SSH

```bash
sudo tee /etc/ssh/sshd_config.d/10-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers ubuntu
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
EOF
sudo sshd -t && sudo systemctl reload ssh
```

Prueba **en una sesión nueva** que sigues entrando con la clave antes de cerrar la anterior.

> No intentes limitar `sshd` a la IP de Tailscale con `ListenAddress`: en las versiones recientes de Ubuntu, `ssh` se activa por *socket* y esa directiva no se aplica sin tocar la unidad del *socket* [VERIFICAR]. La protección va en los cortafuegos (§6).

### 3.5 Actualizaciones de seguridad automáticas

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades    # responde «Sí»
```

Para el reinicio automático hay que esperar a la decisión sobre el cifrado del disco (`plan.md` §7.8, pregunta 39):

- **Si no se cifra el disco (recomendación A)**: permite el reinicio nocturno. En `/etc/apt/apt.conf.d/50unattended-upgrades` pon `Unattended-Upgrade::Automatic-Reboot "true";` y `Unattended-Upgrade::Automatic-Reboot-Time "04:30";` (hora UTC). Los contenedores arrancan solos (`restart: unless-stopped`).
- **Si se cifra un volumen (opción C)**: déjalo en `"false"` y reinicia tú, porque tras cada arranque hay que desbloquear el volumen a mano.

### 3.6 Memoria de reserva (swap)

Con 2 GB de RAM y PostgreSQL, Node, Caddy y Docker, un poco de *swap* evita que el sistema mate procesos en un pico (inferencia; el spike lo medirá):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-swappiness.conf && sudo sysctl --system
free -h
```

---

## 4. Tailscale en el servidor

### 4.1 Cuenta de Tailscale

1. Crea la cuenta de Tailscale con un proveedor de identidad **protegido con MFA** (el que elijas: quien controla esa identidad controla la *tailnet*). El plan **Personal** es gratuito (`plan.md` §7.7).
2. En la consola de administración → **Access controls** (ACL) [VERIFICAR el nombre y la sintaxis, que Tailscale cambia]: sustituye la política por defecto (todos con todos) por una mínima:

```json
{
  "tagOwners": { "tag:server": ["autogroup:admin"] },
  "acls": [
    { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:server:22,443"] }
  ]
}
```

Efecto: tus dispositivos pueden llegar al servidor por SSH y HTTPS, pero **el servidor no puede iniciar conexiones hacia tus dispositivos**. Si el servidor se compromete, no sirve de trampolín hacia tu PC o tu iPhone.

3. Genera una **clave de autenticación** de un solo uso: *Settings* → *Keys* → *Generate auth key*; márcala como **de un solo uso** (*one-off*), con etiqueta `tag:server` y caducidad corta [VERIFICAR].

### 4.2 Instalar y conectar

Instala Tailscale con el **repositorio apt oficial** de Tailscale para tu versión de Ubuntu (guía de instalación en Linux de la documentación de Tailscale) [VERIFICAR los comandos vigentes]. Si prefieres el script de instalación, **descárgalo y léelo antes de ejecutarlo**; no lo canalices a `sh` sin mirar.

Conéctalo sin dejar la clave en el historial:

```bash
read -rs TS_KEY                       # pega la clave y pulsa Intro (no se ve)
sudo tailscale up --auth-key="$TS_KEY" --hostname=<NOMBRE_SERVIDOR> --advertise-tags=tag:server
unset TS_KEY
tailscale ip -4                       # esta es <IP_TAILSCALE_SERVIDOR> (empieza por 100.)
```

Los dispositivos con etiqueta no caducan la clave por defecto [VERIFICAR]. Es lo que quieres para un servidor.

### 4.3 Tailscale en tu PC con Windows

```powershell
winget install Tailscale.Tailscale    # [VERIFICAR el identificador del paquete]
```

Inicia sesión con la misma identidad. Comprueba que ves el servidor:

```powershell
tailscale ping <NOMBRE_SERVIDOR>
```

### 4.4 Probar SSH por Tailscale

Edita `~\.ssh\config` (créalo si no existe) para no repetir opciones:

```text
Host backoffice
    HostName <NOMBRE_SERVIDOR>
    User ubuntu
    IdentityFile ~/.ssh/backoffice_prod
    IdentitiesOnly yes
```

```powershell
ssh backoffice
```

**No sigas hasta que esto funcione.** Si no entra, repasa la ACL (§4.1) y que Tailscale esté activo en el PC.

---

## 5. Docker

### 5.1 Instalar desde el repositorio oficial de Docker

Sigue la guía oficial de instalación de Docker Engine para Ubuntu (método del repositorio apt) [VERIFICAR: los comandos y la compatibilidad con tu versión de Ubuntu cambian]. En esencia: añadir la clave y el repositorio de Docker y ejecutar

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

No instales el paquete `docker.io` de Ubuntu ni uses scripts de terceros.

### 5.2 Configuración mínima

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "10" },
  "live-restore": true
}
EOF
sudo systemctl restart docker
sudo docker run --rm hello-world
```

### 5.3 Dos advertencias

- **No añadas tu usuario al grupo `docker`**: equivale a darle `root` sin contraseña. Usa `sudo docker …`.
- **Docker abre los puertos que publicas saltándose `ufw`** (manipula `iptables` directamente) [VERIFICAR con la versión instalada]. Por eso, en `compose`, los puertos de Caddy se publican **solo en la IP de Tailscale** (`<IP_TAILSCALE_SERVIDOR>:443:443`), nunca como `443:443`. PostgreSQL y la API **no publican ningún puerto**: solo la red interna de Docker. Lo implementa el PR del spike; aquí queda la razón.

---

## 6. Cortafuegos: cerrar todo lo público

Solo ahora, con SSH por Tailscale comprobado (§4.4).

### 6.1 `ufw` en el servidor (segunda capa)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw allow in on tailscale0 to any port 443 proto tcp
sudo ufw enable
sudo ufw status verbose
```

### 6.2 Cortafuegos de Lightsail (primera capa)

Consola de Lightsail → tu instancia → **Networking** → *IPv4 Firewall* [VERIFICAR]:

1. Elimina la regla de **SSH (22)** y la de **HTTP (80)**.
2. Haz lo mismo en *IPv6 Firewall*.
3. No añadas ninguna regla. Tailscale funciona con conexiones **salientes** y, si no puede abrir un camino directo, usa los servidores de retransmisión de Tailscale (DERP) [VERIFICAR].

### 6.3 Comprobación desde fuera

Con Tailscale **desactivado** en tu PC (o desde el punto de acceso del móvil), prueba la IP pública:

```powershell
Test-NetConnection <IP_PUBLICA> -Port 22
Test-NetConnection <IP_PUBLICA> -Port 80
Test-NetConnection <IP_PUBLICA> -Port 443
```

Los tres deben dar `TcpTestSucceeded : False`. Después, con Tailscale activado, `ssh backoffice` debe seguir entrando.

---

## 7. Dominio

### 7.1 Comprarlo

Opciones razonables [VERIFICAR precios y disponibilidad de cada una; este documento no fija ninguna cifra]:

- **Cloudflare Registrar**: cobra el precio de coste, sin recargo, y deja el DNS ya en Cloudflare (menos pasos). Solo admite algunas extensiones.
- **Otro registrador** (de prestigio y con 2FA) y después **delegar el DNS en Cloudflare** cambiando los servidores de nombres (§8.1).

Criterios:
- Una extensión con **precio de renovación razonable** (el primer año suele ser más barato que los siguientes: mira la renovación).
- **Activa la renovación automática** y el 2FA de la cuenta del registrador.
- Activa la **privacidad del WHOIS** (la mayoría de registradores la ofrecen o la aplican por defecto) [VERIFICAR].
- Evita nombres que revelen tu identidad o lo que haya detrás.

### 7.2 Qué es público y qué no

El dominio **no es secreto** y la seguridad no debe depender de ocultarlo:

- Los certificados públicos (Let's Encrypt) se registran en los registros públicos de **Transparencia de Certificados (CT)**. Quien busque tu dominio verá el nombre del certificado.
- Un registro DNS que apunta a una IP `100.x` delata que el servicio está en una *tailnet*, pero no sirve para entrar.
- **Mitigación de privacidad (recomendada)**: pide un **certificado comodín** (`*.<TU_DOMINIO>`) por DNS-01. En CT solo aparece el comodín, no el nombre de tu subdominio. Caddy lo soporta con DNS-01; el detalle de la configuración va en el PR del spike.
- La regla de `CLAUDE.md` sigue: **el dominio no entra en el repositorio** (`PUBLIC_ORIGIN`).

---

## 8. Cloudflare

### 8.1 Añadir el dominio

1. Crea la cuenta de Cloudflare (con 2FA y el correo exclusivo). Plan **gratuito** [VERIFICAR que incluya lo que necesitas].
2. *Add a site* → tu dominio → plan gratuito.
3. Si el dominio no está en Cloudflare Registrar: en el registrador, sustituye los **servidores de nombres** por los dos que te indique Cloudflare. La propagación puede tardar de minutos a horas.

### 8.2 Registros DNS

En *DNS → Records*:

| Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|
| `A` | `<SUBDOMINIO>` | `<IP_TAILSCALE_SERVIDOR>` | **Solo DNS** (nube **gris**) |

**Importante: la nube debe estar gris (*DNS only*).** Con el proxy de Cloudflare (nube naranja) el tráfico pasaría por Cloudflare, que lo descifraría: es la opción C descartada en `plan.md` §7.2, y además una IP `100.x` no es alcanzable desde fuera.

Añade también registros **CAA** para que solo Let's Encrypt pueda emitir certificados:

| Tipo | Nombre | Etiqueta | Valor |
|---|---|---|---|
| `CAA` | `@` | `issue` | `letsencrypt.org` |
| `CAA` | `@` | `issuewild` | `letsencrypt.org` |

Activa **DNSSEC** en Cloudflare y, si hace falta, copia el registro DS al registrador [VERIFICAR].

### 8.3 Token de API para el certificado (DNS-01)

*My Profile → API Tokens → Create Token* [VERIFICAR]:

- Plantilla «Edit zone DNS», o personalizada con permisos `Zone · DNS · Edit` y `Zone · Zone · Read` [VERIFICAR contra la documentación del módulo de Caddy para Cloudflare].
- **Recursos de zona**: solo tu zona. Nunca «todas las zonas».
- Opcional: restringe por IP a la IP pública del servidor (las llamadas a la API salen de ahí) y pon caducidad; apúntala para rotar el token (`docs/runbooks/` de rotación, fase 2b).
- Copia el token **una sola vez** al gestor y al archivo de entorno del servidor (`600`, fuera del repositorio) cuando lo pida el PR del spike. **No lo pegues en ningún chat, issue ni commit.**

### 8.4 Desde Windows: comprobar que el nombre resuelve

```powershell
Resolve-DnsName <SUBDOMINIO>.<TU_DOMINIO>
```

Debe devolver la IP `100.x`. **Prueba también desde la red Wi-Fi de casa**: algunos routers y servidores DNS filtran las respuestas que apuntan a direcciones privadas (*protección contra DNS rebinding*) y podrían descartar un `100.x` [VERIFICAR]. Si pasa, hay que tratar el nombre de otra forma (p. ej., desactivar esa protección para el dominio); se apunta como hallazgo del spike.

---

## 9. Tailscale en el iPhone (VPN On Demand)

1. Instala **Tailscale** desde la App Store e inicia sesión con la **misma identidad**.
2. Autoriza la configuración de VPN cuando iOS lo pida.
3. Activa **VPN On Demand**: en la app de Tailscale, Ajustes → opción de VPN On Demand [VERIFICAR el nombre exacto; la guía vigente es la de Tailscale «iOS VPN On Demand»]. Elige **Siempre**, tanto en **Wi-Fi** como en **datos móviles** (`plan.md` §7.2).
4. **No uses otra VPN con On Demand a la vez**: iOS solo admite una y desactiva la de Tailscale si activas otra (`plan.md` §7.2). Es uno de los criterios para pasar a la opción A.
5. **Caducidad de la clave del dispositivo**: por defecto las claves de los dispositivos de usuario caducan (180 días según la documentación) y entonces el iPhone **pierde la conexión sin avisar** [VERIFICAR]. Desactiva la caducidad de ese dispositivo en la consola de administración (*Machines → ⋯ → Disable key expiry*) o apunta la fecha y vuelve a autenticar antes. Si no lo haces, el atajo fallará por esta causa y contará como `N_fallo_vpn`.
6. Anota la versión de iOS y de la app de Tailscale (van a `docs/atajo-iphone.md`, solo versiones).
7. Comprobaciones, de momento limitadas porque aún no hay aplicación desplegada:
   - Con Tailscale activo, abre la app de Tailscale: el servidor debe aparecer como alcanzable.
   - Con Tailscale desactivado a mano, `<SUBDOMINIO>.<TU_DOMINIO>` debe **no** cargar (tiempo agotado). Vuelve a activarlo.
   - Cuando exista Caddy (PR del spike), repite en Safari: con VPN carga; sin VPN, no.

---

## 10. Recuperación y mantenimiento

### 10.1 Si pierdes el acceso por Tailscale

Lightsail **no ofrece una consola serie de rescate** [VERIFICAR]. El camino es abrir el SSH por un rato:

1. Consola de Lightsail → Networking → *IPv4 Firewall* → añade SSH (22) **restringido a tu IP actual** (no a «cualquiera»).
2. `ssh -i ~\.ssh\backoffice_prod ubuntu@<IP_PUBLICA>`, arregla Tailscale (`sudo tailscale up`, `systemctl status tailscaled`) y `ufw` (`sudo ufw status`).
3. **Quita la regla** al terminar y repite la §6.3.

Mantén anotada (en privado) la IP pública. Si la instancia se detiene y arranca, la IP pública puede cambiar a no ser que le asocies una IP estática [VERIFICAR el coste y las condiciones].

### 10.2 Instantáneas

Una instantánea manual antes de un cambio grande (p. ej., actualizar de versión de Ubuntu) es barata [VERIFICAR el precio, `plan.md` §7.7], pero **bórrala después**: las copias de verdad son las de restic (`plan.md` §6.3), y una instantánea con datos reales en AWS es otra copia más que proteger (`plan.md` §7.8).

### 10.3 Revisión periódica

| Frecuencia | Qué |
|---|---|
| Mensual | `sudo apt list --upgradable`; `sudo docker system df`; espacio en disco (`df -h`); revisar el correo de alertas de AWS |
| Trimestral | Prueba de restauración (`plan.md` §6.3); revisar los usuarios y el MFA de AWS |
| Antes de que caduquen | Token de Cloudflare; renovación del dominio; clave del iPhone en Tailscale |

---

## Qué sigue

Con el servidor, el dominio y las redes listos, el siguiente paso es el PR del spike (2a): la imagen de producción, Caddy con DNS-01 y las pruebas T1–T3, T7–T9 y T16 en el iPhone (orden en `docs/plan.md` §8, fase 2). Los runbooks de despliegue, copias y rotación de secretos se escriben en la fase 2b.
