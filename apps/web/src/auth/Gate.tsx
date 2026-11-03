/**
 * Guarda de las pantallas: muestra su contenido solo si la sesión está en el estado esperado y, si
 * no, lleva a la pantalla que corresponde. La API vuelve a comprobarlo todo: esto solo es navegación.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ErrorMessage, Loading } from '../ui/forms.tsx';
import { HOME_OF, placeOf, safeInternalPath, useSession, type SessionPlace } from './session.ts';

interface GateProps {
  place: SessionPlace;
  children: ReactNode;
}

export function Gate({ place, children }: GateProps) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <Loading />;
  if (session.isError) {
    return (
      <div className="p-6">
        <ErrorMessage error={session.error} />
      </div>
    );
  }
  const current = placeOf(session.data);
  if (current === place) return children;

  // Al salir de una pantalla interna, se recuerda para volver a ella después de entrar o desbloquear.
  // Entre las pantallas de acceso, se conserva el destino que ya hubiera.
  const back =
    place === 'active'
      ? location.pathname + location.search
      : safeInternalPath(new URLSearchParams(location.search).get('volver'));
  const target = HOME_OF[current];
  const search = current !== 'active' && back !== '/' ? `?volver=${encodeURIComponent(back)}` : '';
  return <Navigate to={current === 'active' ? back : target + search} replace />;
}
