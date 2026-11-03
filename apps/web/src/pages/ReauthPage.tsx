/**
 * Reautenticación (contraseña + código TOTP) antes de una acción sensible: cambiar la contraseña o el
 * segundo factor, regenerar los códigos o cerrar sesiones. Vale 10 minutos.
 */
import { sessionResponseSchema, type ReauthRequest } from '@backoffice/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { safeInternalPath, storeSession, useSession } from '../auth/session.ts';
import { AuthCard, Button, ErrorMessage, Field } from '../ui/forms.tsx';

export function ReauthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const back = safeInternalPath(params.get('volver'));
  const session = useSession();
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');

  const reauth = useMutation({
    mutationFn: (input: ReauthRequest) =>
      api('/auth/reauth', { method: 'POST', body: input, schema: sessionResponseSchema }),
    onSuccess: async (result) => {
      storeSession(queryClient, result);
      await navigate(back, { replace: true });
    },
    onError: () => {
      setPassword('');
      setTotp('');
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    reauth.mutate({ password, totp });
  }

  return (
    <AuthCard title="Confirma que eres tú">
      <p className="text-sm text-slate-600">
        Esta acción es sensible. Escribe tu contraseña y un código de la app de autenticación.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input
          type="text"
          hidden
          readOnly
          autoComplete="username"
          value={session.data?.user.username ?? ''}
        />
        <Field
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus
        />
        <Field
          label="Código de la app de autenticación"
          value={totp}
          onChange={setTotp}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
        />
        <ErrorMessage error={reauth.error} />
        <Button disabled={reauth.isPending}>Confirmar</Button>
        <Button type="button" variant="secondary" onClick={() => void navigate(back)}>
          Cancelar
        </Button>
      </form>
    </AuthCard>
  );
}
