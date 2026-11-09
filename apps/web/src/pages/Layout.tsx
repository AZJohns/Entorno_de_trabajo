/** Marco de las pantallas internas: navegación y botón de salir. */
import { NavLink, Outlet } from 'react-router';
import { useLogout, useSession } from '../auth/session.ts';
import { Button } from '../ui/forms.tsx';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm ${isActive ? 'font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900'}`;

export function Layout() {
  const session = useSession();
  const logout = useLogout();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-semibold">Backoffice</span>
          <NavLink to="/" end className={linkClass}>
            Inicio
          </NavLink>
          <NavLink to="/cuentas" className={linkClass}>
            Cuentas
          </NavLink>
          <NavLink to="/movimientos" className={linkClass}>
            Movimientos
          </NavLink>
          <NavLink to="/transferencias" className={linkClass}>
            Transferencias
          </NavLink>
          <NavLink to="/presupuesto" className={linkClass}>
            Presupuesto
          </NavLink>
          <NavLink to="/tareas" className={linkClass}>
            Tareas
          </NavLink>
          <NavLink to="/informes" className={linkClass}>
            Informes
          </NavLink>
          <NavLink to="/categorias" className={linkClass}>
            Categorías
          </NavLink>
          <NavLink to="/ajustes/seguridad" className={linkClass}>
            Seguridad
          </NavLink>
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{session.data?.user.username}</span>
          <Button type="button" variant="secondary" onClick={() => void logout()}>
            Salir
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-4">
        <Outlet />
      </main>
    </div>
  );
}

export function HomePage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Inicio</h1>
      <p className="text-sm text-slate-600">
        Las finanzas, las tareas y las notas llegarán en las siguientes fases.
      </p>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <main className="p-6 text-slate-800">
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
    </main>
  );
}
