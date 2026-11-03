// @vitest-environment jsdom
/**
 * Formularios con lógica: importe del movimiento y conciliación. Comprueban lo que ve y puede hacer la
 * persona: etiquetas, errores por campo, foco y lo que se envía.
 */
import type { AccountResponse, CategoryResponse } from '@backoffice/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { MovementForm } from '../src/finance/forms/MovementForm.tsx';
import { ReconciliationForm } from '../src/finance/forms/ReconciliationForm.tsx';
import { ConfirmBar } from '../src/ui/finance-forms.tsx';

afterEach(cleanup);

const A = '11111111-1111-4111-8111-111111111111';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const accounts: AccountResponse[] = [
  {
    id: A,
    name: 'Cuenta de prueba',
    type: 'checking',
    currency: 'EUR',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    balanceCents: 0,
    archived: false,
  },
];
const categories: CategoryResponse[] = [
  { id: C, name: 'Comida', kind: 'expense', archived: false },
  { id: D, name: 'Nómina', kind: 'income', archived: false },
];

function problem(status: number, code: 'CONFLICT' | 'UNPROCESSABLE', detail: string): ApiError {
  return new ApiError(status, code, { type: 'about:blank', title: 'Error', status, detail, code });
}

describe('MovementForm (alta)', () => {
  function setup(extra: { error?: unknown } = {}) {
    const onCreate = vi.fn();
    const onUpdate = vi.fn();
    const onCancel = vi.fn();
    render(
      <MovementForm
        accounts={accounts}
        categories={categories}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onCancel={onCancel}
        {...extra}
      />,
    );
    return { onCreate, onUpdate, onCancel, user: userEvent.setup() };
  }

  it('todos los campos tienen etiqueta y el importe recibe el foco al abrir', () => {
    setup();
    for (const label of [
      'Tipo',
      'Importe',
      'Cuenta',
      'Categoría',
      'Fecha',
      'Concepto (opcional)',
      'Comercio (opcional)',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(document.activeElement).toBe(screen.getByLabelText('Importe'));
  });

  it('un importe no válido muestra el error, lo marca y lleva el foco al campo; no envía', async () => {
    const { onCreate, user } = setup();
    await user.type(screen.getByLabelText('Importe'), '0,001');
    await user.selectOptions(screen.getByLabelText('Cuenta'), A);
    await user.selectOptions(screen.getByLabelText('Categoría'), C);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText('El importe admite como máximo dos decimales')).toBeTruthy();
    const amount = screen.getByLabelText('Importe');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(amount.getAttribute('aria-describedby')).toContain('error');
    expect(document.activeElement).toBe(amount);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('con datos válidos envía el importe en céntimos, sin decimales de coma flotante', async () => {
    const { onCreate, user } = setup();
    await user.type(screen.getByLabelText('Importe'), '1.234,56');
    await user.selectOptions(screen.getByLabelText('Cuenta'), A);
    await user.selectOptions(screen.getByLabelText('Categoría'), C);
    await user.clear(screen.getByLabelText('Fecha'));
    await user.type(screen.getByLabelText('Fecha'), '2026-10-10');
    await user.type(screen.getByLabelText('Concepto (opcional)'), 'Compra');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onCreate).toHaveBeenCalledWith({
      kind: 'expense',
      amountCents: 123_456,
      accountId: A,
      categoryId: C,
      bookedOn: '2026-10-10',
      description: 'Compra',
      merchant: null,
    });
  });

  it('solo ofrece las categorías del tipo elegido y descarta la elegida al cambiar de tipo', async () => {
    const { user } = setup();
    const category = screen.getByLabelText('Categoría');
    expect([...category.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Elige una categoría',
      'Comida',
    ]);
    await user.selectOptions(category, C);
    await user.selectOptions(screen.getByLabelText('Tipo'), 'income');
    expect(screen.getByLabelText<HTMLSelectElement>('Categoría').value).toBe('');
    expect(
      [...screen.getByLabelText('Categoría').querySelectorAll('option')].map((o) => o.textContent),
    ).toEqual(['Elige una categoría', 'Nómina']);
  });

  it('distingue el 409 («No se puede hacer ahora») del 422 («Revisa los datos») y muestra el mensaje de la API', () => {
    const conflict = problem(409, 'CONFLICT', 'La cuenta «X» está archivada');
    const { unmount } = render(
      <MovementForm
        accounts={accounts}
        categories={categories}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onCancel={vi.fn()}
        error={conflict}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No se puede hacer ahora');
    expect(alert.textContent).toContain('La cuenta «X» está archivada');
    unmount();

    render(
      <MovementForm
        accounts={accounts}
        categories={categories}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onCancel={vi.fn()}
        error={problem(422, 'UNPROCESSABLE', 'La fecha es anterior a la apertura de la cuenta')}
      />,
    );
    const alert422 = screen.getByRole('alert');
    expect(alert422.textContent).toContain('Revisa los datos');
    expect(alert422.textContent).toContain('anterior a la apertura');
  });
});

describe('ReconciliationForm', () => {
  function setup(extra: { error?: unknown } = {}) {
    const onSubmit = vi.fn();
    render(<ReconciliationForm onSubmit={onSubmit} today="2026-10-20" {...extra} />);
    return { onSubmit, user: userEvent.setup() };
  }

  it('propone hoy como fecha y su mes', () => {
    setup();
    expect(screen.getByLabelText<HTMLInputElement>('Fecha del saldo del banco').value).toBe(
      '2026-10-20',
    );
    expect(screen.getByText(/Se concilia octubre de 2026/u)).toBeTruthy();
  });

  it('sin saldo del banco no envía y lleva el foco al campo', async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Conciliar' }));
    expect(screen.getByText('Escribe un importe')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Saldo según el banco'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('envía el saldo del banco en céntimos, también negativo', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText('Saldo según el banco'), '-1.234,50');
    await user.type(screen.getByLabelText('Nota (opcional)'), 'Extracto de octubre');
    await user.click(screen.getByRole('button', { name: 'Conciliar' }));
    expect(onSubmit).toHaveBeenCalledWith({
      month: '2026-10',
      asOf: '2026-10-20',
      statementBalanceCents: -123_450,
      note: 'Extracto de octubre',
    });
  });

  it('un saldo con el formato mal escrito da su mensaje', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText('Saldo según el banco'), '1.23.456');
    await user.click(screen.getByRole('button', { name: 'Conciliar' }));
    expect(screen.getByText(/Importe no válido/u)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('el mes sigue a la fecha elegida', async () => {
    const { onSubmit, user } = setup();
    const date = screen.getByLabelText('Fecha del saldo del banco');
    await user.clear(date);
    await user.type(date, '2026-09-30');
    expect(screen.getByText(/Se concilia septiembre de 2026/u)).toBeTruthy();
    await user.type(screen.getByLabelText('Saldo según el banco'), '0');
    await user.click(screen.getByRole('button', { name: 'Conciliar' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ month: '2026-09', statementBalanceCents: 0 }),
    );
  });

  it('el 409 de «mes ya conciliado» se muestra con su mensaje', () => {
    setup({
      error: problem(
        409,
        'CONFLICT',
        'Esa cuenta ya está conciliada en ese mes: borra la conciliación para rehacerla',
      ),
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No se puede hacer ahora');
    expect(alert.textContent).toContain('ya está conciliada en ese mes');
  });
});

describe('ConfirmBar', () => {
  it('lleva el foco a «Cancelar» y Escape cancela', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmBar
        message="¿Borrar?"
        confirmLabel="Borrar"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.setup().keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
