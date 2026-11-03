/**
 * Restablece la contraseña desde el servidor (requiere acceso SSH, equivalente a la verificación de
 * identidad del alta, ASVS 6.4.4). NO desactiva el TOTP (ASVS 6.4.3) y cierra todas las sesiones.
 *
 * Uso: `pnpm --filter @backoffice/api user:reset-password`
 */
import { ask, askNewPassword, openAuthService, run } from './lib/cli.ts';

await run(async () => {
  const { service, close } = openAuthService();
  try {
    const username = await ask('Nombre de usuario: ');
    await service.resetPassword(username, await askNewPassword());
    console.log('Contraseña cambiada. Todas las sesiones se han cerrado; el TOTP sigue activo.');
  } finally {
    await close();
  }
});
