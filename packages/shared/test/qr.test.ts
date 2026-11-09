import { describe, expect, it } from 'vitest';
import { QR_QUIET_ZONE, qrMatrix, qrToTerminalLines } from '../src/index.ts';

const URI =
  'otpauth://totp/Backoffice:usuario?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&issuer=Backoffice&algorithm=SHA256&digits=6&period=30';

describe('qrMatrix', () => {
  it('genera una matriz cuadrada de una versión QR válida (21 + 4·(v−1) módulos)', () => {
    const matrix = qrMatrix(URI);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect((matrix.length - 21) % 4).toBe(0);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
  });

  it('es determinista y contiene los tres patrones de posición de las esquinas', () => {
    const matrix = qrMatrix(URI);
    expect(qrMatrix(URI)).toEqual(matrix);
    const last = matrix.length - 1;
    // Cada patrón de posición es un cuadrado de 7×7 con el borde oscuro y el centro 3×3 oscuro.
    for (const [r, c] of [
      [0, 0],
      [0, last - 6],
      [last - 6, 0],
    ] as const) {
      expect(matrix[r]?.[c]).toBe(true);
      expect(matrix[r + 1]?.[c + 1]).toBe(false);
      expect(matrix[r + 3]?.[c + 3]).toBe(true);
    }
  });

  it('un texto distinto da una matriz distinta', () => {
    expect(qrMatrix(`${URI}x`)).not.toEqual(qrMatrix(URI));
  });
});

describe('qrToTerminalLines', () => {
  it('añade la zona de silencio y usa dos filas de módulos por línea', () => {
    const matrix = qrMatrix(URI);
    const lines = qrToTerminalLines(matrix);
    const total = matrix.length + 2 * QR_QUIET_ZONE;
    expect(lines).toHaveLength(Math.ceil(total / 2));
    // Un «▀» por columna, y cada línea termina con el reinicio de colores.
    // eslint-disable-next-line no-control-regex -- los códigos ANSI llevan el carácter ESC
    const visible = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ''));
    expect(visible.every((line) => line === '▀'.repeat(total))).toBe(true);
    expect(lines.every((line) => line.endsWith('\u001b[0m'))).toBe(true);
  });

  it('la zona de silencio es blanca y los módulos oscuros, negros', () => {
    const lines = qrToTerminalLines([[true]], 1);
    // 3×3 módulos → 2 líneas. Primera: arriba blanco (silencio); abajo, fila 1: blanco, negro, blanco.
    expect(lines).toEqual([
      '\u001b[97m\u001b[107m▀\u001b[97m\u001b[40m▀\u001b[97m\u001b[107m▀\u001b[0m',
      // Segunda: arriba, la fila 2 (silencio, blanca); abajo, fuera de la matriz (blanca).
      '\u001b[97m\u001b[107m▀\u001b[97m\u001b[107m▀\u001b[97m\u001b[107m▀\u001b[0m',
    ]);
  });
});
