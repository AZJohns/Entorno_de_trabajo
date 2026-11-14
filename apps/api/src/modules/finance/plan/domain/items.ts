/**
 * Acceso a las filas de Datos por identificador y lectura de sus importes. Una referencia que no existe o una
 * fila sin importe donde hace falta uno es una foto incoherente (el importador y las claves ajenas
 * compuestas lo impiden): se lanza `RangeError` en vez de seguir con un 0 que escondería el fallo.
 */
import type { Cents } from '@backoffice/shared';
import type { PlanItem } from './types.ts';

/** Filas de Datos de una foto por `id`. */
export type ItemIndex = ReadonlyMap<string, PlanItem>;

export function indexItems(items: readonly PlanItem[]): ItemIndex {
  const index = new Map<string, PlanItem>();
  for (const item of items) {
    if (index.has(item.id)) throw new RangeError(`Fila de Datos repetida: ${item.id}`);
    index.set(item.id, item);
  }
  return index;
}

/** La fila de Datos con ese `id`. @throws {RangeError} si no existe en la foto. */
export function itemById(index: ItemIndex, id: string, what: string): PlanItem {
  const item = index.get(id);
  if (item === undefined) throw new RangeError(`${what}: la fila de Datos ${id} no existe`);
  return item;
}

/** El importe en céntimos de una fila. @throws {RangeError} si la fila no tiene importe (su unidad son meses). */
export function amountOf(item: PlanItem, what: string): Cents {
  if (item.amountCents === null) {
    throw new RangeError(`${what}: la fila ${item.id} («${item.concept}») no tiene importe`);
  }
  return item.amountCents;
}

/** Los meses en centésimas de una fila. @throws {RangeError} si la fila no está en meses. */
export function hundredthsOf(item: PlanItem, what: string): number {
  if (item.quantityHundredths === null) {
    throw new RangeError(`${what}: la fila ${item.id} («${item.concept}») no está en meses`);
  }
  return item.quantityHundredths;
}
