/** Categorías de gasto e ingreso: alta, renombrar y archivar. */
import type { CategoryResponse } from '@backoffice/shared';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, ErrorMessage, Loading } from '../../ui/forms.tsx';
import { ConfirmBar, ProblemNotice, SelectField, TextField } from '../../ui/finance-forms.tsx';
import {
  useArchiveCategory,
  useCategories,
  useCreateCategory,
  useRenameCategory,
} from '../queries.ts';

function CreateCategory() {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('expense');
  const [error, setError] = useState<string | undefined>();
  const create = useCreateCategory();

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim() === '') {
      setError('Este campo es obligatorio');
      return;
    }
    setError(undefined);
    create.mutate(
      { name, kind: kind === 'income' ? 'income' : 'expense' },
      { onSuccess: () => setName('') },
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Nueva categoría"
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">Nueva categoría</h2>
      <TextField label="Nombre" value={name} onChange={setName} error={error} maxLength={100} />
      <SelectField
        label="Tipo"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Gasto' },
          { value: 'income', label: 'Ingreso' },
        ]}
      />
      <ProblemNotice error={create.error} />
      <div>
        <Button disabled={create.isPending}>Añadir categoría</Button>
      </div>
    </form>
  );
}

function CategoryRow({ category }: { category: CategoryResponse }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(category.name);
  const rename = useRenameCategory();
  const archive = useArchiveCategory();

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim() === category.name) {
      setEditing(false);
      return;
    }
    rename.mutate({ id: category.id, name }, { onSuccess: () => setEditing(false) });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
      {editing ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <TextField label="Nombre" value={name} onChange={setName} maxLength={100} autoFocus />
          <ProblemNotice error={rename.error} />
          <div className="flex gap-2">
            <Button disabled={rename.isPending}>Guardar</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setName(category.name);
                rename.reset();
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {category.name}
            {category.archived && (
              <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs">Archivada</span>
            )}
          </span>
          {!category.archived && (
            <span className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                Renombrar<span className="sr-only"> {category.name}</span>
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
                Archivar<span className="sr-only"> {category.name}</span>
              </Button>
            </span>
          )}
        </div>
      )}
      {confirming && (
        <>
          <ConfirmBar
            message={`¿Archivar «${category.name}»? No podrás usarla en movimientos nuevos.`}
            confirmLabel="Archivar categoría"
            pending={archive.isPending}
            onConfirm={() => archive.mutate(category.id, { onSuccess: () => setConfirming(false) })}
            onCancel={() => setConfirming(false)}
          />
          <ProblemNotice error={archive.error} />
        </>
      )}
    </li>
  );
}

export function CategoriesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const categories = useCategories(showArchived);
  const groups = [
    { kind: 'expense', title: 'Gastos' },
    { kind: 'income', title: 'Ingresos' },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Categorías</h1>
      <CreateCategory />
      <Checkbox label="Mostrar archivadas" checked={showArchived} onChange={setShowArchived} />
      {categories.isPending && <Loading />}
      <ErrorMessage error={categories.error} />
      {groups.map((group) => {
        const items = categories.data?.filter((category) => category.kind === group.kind) ?? [];
        return (
          <section
            key={group.kind}
            aria-labelledby={`cat-${group.kind}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`cat-${group.kind}`} className="text-lg font-semibold">
              {group.title}
            </h2>
            {categories.data !== undefined && items.length === 0 && (
              <p className="text-sm text-slate-600">No hay categorías de este tipo.</p>
            )}
            <ul className="flex flex-col gap-2">
              {items.map((category) => (
                <CategoryRow key={category.id} category={category} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
