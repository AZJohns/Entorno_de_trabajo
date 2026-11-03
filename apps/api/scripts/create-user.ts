/**
 * Crea el ÚNICO usuario de la aplicación con su contraseña, su TOTP y sus códigos de recuperación, en
 * un solo paso: así nunca existe una sesión sin segundo factor (docs/plan.md §6.2).
 *
 * Muestra UNA SOLA VEZ la clave TOTP, el enlace `otpauth://` y los 10 códigos de recuperación. Guarda
 * los códigos en el gestor de contraseñas: no se pueden volver a consultar.
 *
 * Uso: `pnpm --filter @backoffice/api user:create`
 */
import { ask, askNewPassword, openAuthService, run } from './lib/cli.ts';

await run(async () => {
  const { service, close } = openAuthService();
  try {
    const username = await ask('Nombre de usuario: ');
    const password = await askNewPassword();
    const credentials = await service.createInitialUser(username, password);
    console.log('\nUsuario creado. Da de alta el segundo factor en tu app de autenticación:');
    console.log(`  Clave (manual): ${credentials.totpSecret}`);
    console.log(`  Enlace:         ${credentials.otpauthUri}`);
    console.log(
      '\nCódigos de recuperación (de un solo uso; guárdalos ahora, no se vuelven a mostrar):',
    );
    for (const code of credentials.recoveryCodes) console.log(`  ${code}`);
  } finally {
    await close();
  }
});
