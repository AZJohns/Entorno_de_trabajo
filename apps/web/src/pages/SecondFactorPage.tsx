/** Segundo paso del inicio de sesión: código TOTP o, si no se tiene el móvil, un código de recuperación. */
import { sessionResponseSchema, type SecondFactorRequest } from '@backoffice/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { storeSession, useLogout } from '../auth/session.ts';
import { AuthCard, Button, ErrorMessage, Field } from '../ui/forms.tsx';

export function SecondFactorPage() {
  const queryClient = useQueryClient();
  const logout = useLogout();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');

  const verify = useMutation({
    mutationFn: (input: SecondFactorRequest) =>
      api('/auth/login/second-factor', {
        method: 'POST',
        body: input,
        schema: sessionResponseSchema,
      }),
    // La guarda lleva a la pantalla de destino cuando la sesión pasa a «active».
    onSuccess: (session) => storeSession(queryClient, session),
    onError: () => setCode(''),
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    verify.mutate(useRecovery ? { recoveryCode: code } : { totp: code });
  }

  function toggle(): void {
    setUseRecovery((v) => !v);
    setCode('');
    verify.reset();
  }

  return (
    <AuthCard title="Segundo factor">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {useRecovery ? (
          <Field
            key="recovery"
            label="Código de recuperación"
            value={code}
            onChange={setCode}
            autoComplete="off"
            hint="Cada código solo sirve una vez."
            maxLength={40}
            autoFocus
          />
        ) : (
          <Field
            key="totp"
            label="Código de la app de autenticación"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            hint="6 cifras."
            autoFocus
          />
        )}
        <ErrorMessage error={verify.error} />
        <Button disabled={verify.isPending}>Entrar</Button>
        <Button type="button" variant="secondary" onClick={toggle}>
          {useRecovery ? 'Usar la app de autenticación' : 'Usar un código de recuperación'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void logout()}>
          Cancelar
        </Button>
      </form>
    </AuthCard>
  );
}
