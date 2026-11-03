/**
 * Cierra todas las sesiones del usuario (p. ej., si se pierde un dispositivo). ASVS 7.4.5.
 *
 * Uso: `pnpm --filter @backoffice/api user:revoke-sessions`
 */
import { ask, openAuthService, run } from './lib/cli.ts';

await run(async () => {
  const { service, close } = openAuthService();
  try {
    const revoked = await service.revokeAllSessions(await ask('Nombre de usuario: '));
    console.log(`Sesiones cerradas: ${revoked}.`);
  } finally {
    await close();
  }
});
