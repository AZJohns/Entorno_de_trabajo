/**
 * Desbloqueo de una sesión bloqueada tras 1 h sin uso. Basta la contraseña: la sesión ya se abrió con
 * los dos factores (NIST 800-63B-4, reautenticación por inactividad; docs/adr/0006).
 */
import { sessionResponseSchema } from '@backoffice/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { storeSession, useLogout, useSession } from '../auth/session.ts';
import { AuthCard, Button, ErrorMessage, Field } from '../ui/forms.tsx';

export function UnlockPage() {
  const queryClient = useQueryClient();
  const session = useSession();
  const logout = useLogout();
  const [password, setPassword] = useState('');

  const unlock = useMutation({
    mutationFn: (input: { password: string }) =>
      api('/auth/unlock', { method: 'POST', body: input, schema: sessionResponseSchema }),
    onSuccess: (result) => storeSession(queryClient, result),
    onError: () => setPassword(''),
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    unlock.mutate({ password });
  }

  const username = session.data?.user.username ?? '';
  return (
    <AuthCard title="Sesión bloqueada">
      <p className="text-sm text-slate-600">
        La sesión se ha bloqueado tras una hora sin uso. Escribe tu contraseña para seguir.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Para que el gestor de contraseñas sepa de qué cuenta es la contraseña. */}
        <input type="text" hidden readOnly autoComplete="username" value={username} />
        <Field
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus
        />
        <ErrorMessage error={unlock.error} />
        <Button disabled={unlock.isPending}>Desbloquear</Button>
        <Button type="button" variant="secondary" onClick={() => void logout()}>
          Cerrar sesión
        </Button>
      </form>
    </AuthCard>
  );
}
