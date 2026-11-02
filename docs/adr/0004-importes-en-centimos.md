# ADR 0004 — Importes como enteros en céntimos

- **Estado:** Aceptado
- **Fecha:** 2026-11-02

## Contexto

Los números de coma flotante binaria no representan exactamente la mayoría de las fracciones decimales: `0.1 + 0.2 === 0.30000000000000004`. En una aplicación financiera, estos errores se acumulan en sumas, saldos y proyecciones, y producen diferencias de céntimos difíciles de rastrear.

## Decisión

1. **Todo importe es un entero de céntimos de euro.**
   - En PostgreSQL, `bigint` con el sufijo `_cents`.
   - En JavaScript, un `number` que cumple `Number.isSafeInteger` (hasta unos 90 billones de euros).
2. **Una única utilidad convierte texto ↔ céntimos** (`packages/shared/src/money/money.ts`):
   - `parseEuroAmount` analiza el texto **sin coma flotante**: trabaja con cadenas de dígitos y `BigInt`. Acepta `12,50`, `1.234,56`, `1,234.56` y `12,50 €`. Rechaza más de dos decimales, los grupos de miles mal formados y, salvo que se permita, los negativos. Nunca lanza excepciones con entradas del usuario: devuelve `{ ok, cents }` o `{ ok: false, reason }`.
   - `formatCents` construye la cadena decimal exacta con `BigInt` y se la pasa a `Intl.NumberFormat('es-ES')`, que admite números en forma de cadena. Nunca divide entre 100 en coma flotante.
   - **Prohibido** usar `parseFloat`, `Number(texto)` o `toFixed` con importes fuera de esta utilidad (`CLAUDE.md`).
3. El **signo lo determina el tipo** de movimiento (ingreso o gasto); el importe almacenado es positivo. Excepción: los saldos (p. ej., un saldo inicial en descubierto).
4. Los porcentajes se calculan y comparan con aritmética entera; solo se redondean al mostrarlos.

## Alternativas descartadas

- **`number` con euros decimales**: errores de redondeo acumulativos.
- **`numeric` de PostgreSQL + una librería decimal (decimal.js, big.js)**: es correcto, pero añade una dependencia y obliga a convertir en cada frontera. Con un solo céntimo de precisión y una sola moneda, los enteros bastan y son más simples.
- **Céntimos como `BigInt` en JavaScript**: no se serializan en JSON sin conversión y complican todo el código. Con el límite de `Number.MAX_SAFE_INTEGER` hay margen de sobra.

## Consecuencias

- El driver `pg` devuelve `bigint` y `SUM()` como cadena de texto. Se convertirán a `number` en un único punto, con `Number.isSafeInteger` (fase 1).
- La API intercambia importes en céntimos (`amountCents`) y el formato se aplica solo en la interfaz.
- En `es-ES`, Intl no agrupa los miles en números de 4 cifras (`1234,56 €`). Es la norma CLDR y está cubierto por los tests.
