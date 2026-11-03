/**
 * Geometría de los gráficos: ejes con límites «redondos» y posición de un valor. Es solo presentación
 * (cuántos píxeles ocupa un importe); los importes en sí los calcula la API y nunca se suman aquí.
 */

/** Eje vertical: límites y marcas, en céntimos. */
export interface Axis {
  readonly min: number;
  readonly max: number;
  readonly ticks: readonly number[];
}

/** El paso «bonito» (1, 2, 2,5, 5 × 10ⁿ) más pequeño que cubre `rough`. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const factor = [1, 2, 2.5, 5, 10].find((f) => fraction <= f + 1e-9) ?? 10;
  return factor * power;
}

/**
 * Eje que incluye siempre el 0 y todos los valores. `maxTicks` es orientativo: el número real de
 * marcas depende del paso redondo elegido.
 */
export function niceAxis(values: readonly number[], maxTicks = 5): Axis {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  if (low === 0 && high === 0) return { min: 0, max: 100, ticks: [0, 100] };
  const step = Math.max(1, niceStep((high - low) / Math.max(1, maxTicks - 1)));
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(tick);
  return { min, max, ticks };
}

/** Posición (0 = `from`, 1 = `to`) de `value` en el eje; para dibujar, no para contar dinero. */
export function position(axis: Axis, value: number, from: number, to: number): number {
  const span = axis.max - axis.min;
  return span === 0 ? from : from + ((value - axis.min) / span) * (to - from);
}
