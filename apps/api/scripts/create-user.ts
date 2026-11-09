/**
 * Crea el ÚNICO usuario de la aplicación con su contraseña, su TOTP y sus códigos de recuperación, en
 * un solo paso: así nunca existe una sesión sin segundo factor (docs/plan.md §6.2).
 *
 * Muestra UNA SOLA VEZ el QR del TOTP (generado en local), la clave, el enlace `otpauth://` y los 10
 * códigos de recuperación. Guarda los códigos en el gestor de contraseñas: no se pueden volver a
 * consultar.
 *
 * Uso: `pnpm --filter @backoffice/api user:create`
 */
import { qrMatrix, qrToTerminalLines } from '@backoffice/shared';
import { ask, askNewPassword, openAuthService, run } from './lib/cli.ts';

await run(async () => {
  const { service, close } = openAuthService();
  try {
    const username = await ask('Nombre de usuario: ');
    const password = await askNewPassword();
    const credentials = await service.createInitialUser(username, password);
    console.log('\nUsuario creado. Da de alta el segundo factor en tu app de autenticación:');
    // Los códigos de color ANSI solo tienen sentido en una terminal; si la salida se redirige, se
    // omite el QR (la clave y el enlace siguen ahí) para no guardar secuencias de escape en un archivo.
    if (process.stdout.isTTY) {
      console.log('');
      for (const line of qrToTerminalLines(qrMatrix(credentials.otpauthUri))) console.log(line);
      console.log('');
    }
    console.log(
      `  En Google Authenticator, escanea el QR; con la clave escrita a mano no funcionará\n  (usa ${credentials.totpAlgorithm}, y la app solo lo aplica al escanear).`,
    );
    console.log(`  Clave (solo para apps que no puedan escanear): ${credentials.totpSecret}`);
    console.log(`  Enlace:                                         ${credentials.otpauthUri}`);
    console.log(
      '\nCódigos de recuperación (de un solo uso; guárdalos ahora, no se vuelven a mostrar):',
    );
    for (const code of credentials.recoveryCodes) console.log(`  ${code}`);
  } finally {
    await close();
  }
});
