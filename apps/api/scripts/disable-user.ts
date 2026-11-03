/**
 * Deshabilita la cuenta y cierra todas sus sesiones (ASVS 7.4.2). Para volver a habilitarla hay que
 * hacerlo en la base de datos de forma consciente (no hay script a propósito).
 *
 * Uso: `pnpm --filter @backoffice/api user:disable`
 */
import { ask, openAuthService, run } from './lib/cli.ts';

await run(async () => {
  const { service, close } = openAuthService();
  try {
    await service.disableUser(await ask('Nombre de usuario: '));
    console.log('Cuenta deshabilitada y sesiones cerradas.');
  } finally {
    await close();
  }
});
