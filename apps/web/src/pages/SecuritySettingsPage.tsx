/**
 * Ajustes de seguridad: contraseña, segundo factor, códigos de recuperación y sesiones abiertas.
 * Todas las acciones exigen una reautenticación reciente; la API lo comprueba en cada petición.
 */
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  recoveryCodesResponseSchema,
  sessionListResponseSchema,
  totpEnrollResponseSchema,
  type ChangePasswordRequest,
  type SessionResponse,
  type TotpConfirmRequest,
  type TotpEnrollResponse,
} from '@backoffice/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../api/client.ts';
import { forgetSession, hasRecentReauth, useSession } from '../auth/session.ts';
import { Button, Checkbox, ErrorMessage, Field, Loading, SuccessMessage } from '../ui/forms.tsx';

const SESSIONS_QUERY_KEY = ['auth', 'sessions'] as const;

const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

export function SecuritySettingsPage() {
  const session = useSession();
  if (session.data === undefined || session.data === null) return <Loading />;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Seguridad</h1>
      <ReauthStatus session={session.data} />
      <ChangePassword />
      <ChangeTotp />
      <RecoveryCodes />
      <Sessions />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-white p-5 shadow">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ReauthStatus({ session }: { session: SessionResponse }) {
  const location = useLocation();
  if (hasRecentReauth(session)) {
    const until = session.reauthenticatedUntil ?? '';
    return (
      <SuccessMessage>
        Identidad confirmada hasta las {dateTime.format(new Date(until))}.
      </SuccessMessage>
    );
  }
  const back = encodeURIComponent(location.pathname);
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Para cambiar estos ajustes, primero{' '}
      <Link to={`/reautenticar?volver=${back}`} className="font-medium underline">
        confirma que eres tú
      </Link>
      .
    </p>
  );
}

function ChangePassword() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [terminateOtherSessions, setTerminate] = useState(true);
  const [mismatch, setMismatch] = useState(false);

  const change = useMutation({
    mutationFn: (input: ChangePasswordRequest) =>
      api('/auth/password', { method: 'POST', body: input }),
    onSuccess: async () => {
      setCurrent('');
      setNew('');
      setRepeat('');
      await queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    // Esta comprobación solo evita erratas; la política de contraseñas la aplica la API.
    setMismatch(newPassword !== repeat);
    if (newPassword !== repeat) return;
    change.mutate({ currentPassword, newPassword, terminateOtherSessions });
  }

  return (
    <Section title="Contraseña">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label="Contraseña actual"
          type="password"
          value={currentPassword}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <Field
          label="Contraseña nueva"
          type="password"
          value={newPassword}
          onChange={setNew}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          hint={`${PASSWORD_MIN_LENGTH} caracteres o más. Puede ser una frase. Se comprueba que no esté filtrada.`}
        />
        <Field
          label="Repite la contraseña nueva"
          type="password"
          value={repeat}
          onChange={setRepeat}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
        />
        <Checkbox
          label="Cerrar las demás sesiones"
          checked={terminateOtherSessions}
          onChange={setTerminate}
        />
        {mismatch && (
          <p role="alert" className="text-sm text-red-800">
            Las contraseñas nuevas no coinciden.
          </p>
        )}
        <ErrorMessage error={change.error} />
        {change.isSuccess && <SuccessMessage>Contraseña cambiada.</SuccessMessage>}
        <div>
          <Button disabled={change.isPending}>Cambiar la contraseña</Button>
        </div>
      </form>
    </Section>
  );
}

/** Divide la clave en grupos de 4 para copiarla a mano sin errores. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function ChangeTotp() {
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<TotpEnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [terminateOtherSessions, setTerminate] = useState(true);

  const start = useMutation({
    mutationFn: () =>
      api('/auth/totp/enroll', { method: 'POST', schema: totpEnrollResponseSchema }),
    onSuccess: (result) => {
      setEnrollment(result);
      setCode('');
    },
  });
  const confirm = useMutation({
    mutationFn: (input: TotpConfirmRequest) =>
      api('/auth/totp/confirm', { method: 'POST', body: input }),
    onSuccess: async () => {
      // La clave nueva solo se muestra durante el alta.
      setEnrollment(null);
      setCode('');
      await queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    confirm.mutate({ code, terminateOtherSessions });
  }

  return (
    <Section title="App de autenticación (TOTP)">
      {enrollment === null ? (
        <>
          <p className="text-sm text-slate-600">
            Para cambiar de app o de móvil, genera una clave nueva. La actual sigue funcionando
            hasta que confirmes la nueva.
          </p>
          <ErrorMessage error={start.error} />
          {confirm.isSuccess && <SuccessMessage>App de autenticación cambiada.</SuccessMessage>}
          <div>
            <Button type="button" onClick={() => start.mutate()} disabled={start.isPending}>
              Generar una clave nueva
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            Añade esta clave a tu app de autenticación con el enlace (en el móvil) o escribiéndola a
            mano. Después, escribe el código que muestra.
          </p>
          <p className="rounded-md bg-slate-100 px-3 py-2 font-mono text-sm break-all">
            {groupSecret(enrollment.secret)}
          </p>
          <a href={enrollment.otpauthUri} className="text-sm font-medium underline">
            Abrir en la app de autenticación
          </a>
          <Field
            label="Código de la app"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
          />
          <Checkbox
            label="Cerrar las demás sesiones"
            checked={terminateOtherSessions}
            onChange={setTerminate}
          />
          <ErrorMessage error={confirm.error} />
          <div className="flex gap-2">
            <Button disabled={confirm.isPending}>Confirmar</Button>
            <Button type="button" variant="secondary" onClick={() => setEnrollment(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function RecoveryCodes() {
  const [acknowledged, setAcknowledged] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const regenerate = useMutation({
    mutationFn: () =>
      api('/auth/recovery-codes', { method: 'POST', schema: recoveryCodesResponseSchema }),
    onSuccess: (result) => {
      setCodes(result.codes);
      setAcknowledged(false);
    },
  });

  return (
    <Section title="Códigos de recuperación">
      <p className="text-sm text-slate-600">
        Sirven para entrar sin el móvil. Cada uno vale una vez. Al generar códigos nuevos, los
        anteriores dejan de funcionar.
      </p>
      {codes !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-amber-900">
            Guárdalos ahora en tu gestor de contraseñas: no se vuelven a mostrar.
          </p>
          <ul className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-3 font-mono text-sm">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <div>
            <Button type="button" variant="secondary" onClick={() => setCodes(null)}>
              Ya los he guardado
            </Button>
          </div>
        </div>
      )}
      <Checkbox
        label="Entiendo que los códigos anteriores dejarán de funcionar"
        checked={acknowledged}
        onChange={setAcknowledged}
      />
      <ErrorMessage error={regenerate.error} />
      <div>
        <Button
          type="button"
          onClick={() => regenerate.mutate()}
          disabled={!acknowledged || regenerate.isPending}
        >
          Generar códigos nuevos
        </Button>
      </div>
    </Section>
  );
}

function Sessions() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: () => api('/auth/sessions', { schema: sessionListResponseSchema }),
  });
  const revoke = useMutation({
    mutationFn: (input: { id: string; current: boolean }) =>
      api(`/auth/sessions/${encodeURIComponent(input.id)}`, { method: 'DELETE' }),
    onSuccess: async (_result, input) => {
      // Si se cierra la sesión actual, la web la olvida y la guarda lleva al inicio de sesión.
      if (input.current) forgetSession(queryClient);
      else await queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  return (
    <Section title="Sesiones abiertas">
      {sessions.isPending && <Loading />}
      <ErrorMessage error={sessions.error ?? revoke.error} />
      <ul className="flex flex-col divide-y divide-slate-200">
        {sessions.data?.sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="text-sm">
              <p className="font-medium break-all">
                {s.userAgent ?? 'Navegador desconocido'}
                {s.current && <span className="ml-2 text-green-700">(esta sesión)</span>}
              </p>
              <p className="text-slate-500">
                Abierta: {dateTime.format(new Date(s.createdAt))} · Último uso:{' '}
                {dateTime.format(new Date(s.lastSeenAt))}
              </p>
            </div>
            <Button
              type="button"
              variant="danger"
              onClick={() => revoke.mutate({ id: s.id, current: s.current })}
              disabled={revoke.isPending}
            >
              Cerrar
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
