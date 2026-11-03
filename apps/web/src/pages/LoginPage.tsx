/** Pantalla de inicio de sesión: usuario y contraseña (primer paso). */
import { loginResponseSchema, type LoginRequest } from '@backoffice/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, setCsrfToken } from '../api/client.ts';
import { SESSION_QUERY_KEY } from '../auth/session.ts';
import { AuthCard, Button, ErrorMessage, Field } from '../ui/forms.tsx';

export function LoginPage() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: (input: LoginRequest) =>
      api('/auth/login', { method: 'POST', body: input, schema: loginResponseSchema }),
    onSuccess: async (result) => {
      setCsrfToken(result.csrfToken);
      setPassword('');
      // La guarda lleva a la pantalla del segundo factor cuando la sesión pasa a «pending».
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    login.mutate({ username, password });
  }

  return (
    <AuthCard title="Entrar">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Usuario"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          autoFocus
          maxLength={64}
        />
        <Field
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <ErrorMessage error={login.error} />
        <Button disabled={login.isPending}>Continuar</Button>
      </form>
    </AuthCard>
  );
}
