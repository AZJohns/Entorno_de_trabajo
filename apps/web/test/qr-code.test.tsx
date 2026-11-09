// @vitest-environment jsdom
import { QR_QUIET_ZONE, qrMatrix } from '@backoffice/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QrCode, qrPath } from '../src/ui/QrCode.tsx';

const URI = 'otpauth://totp/Backoffice:usuario?secret=GEZDGNBVGY3TQOJQ&algorithm=SHA256';

/** Reconstruye los módulos oscuros a partir del trazado SVG. */
function darkCells(path: string): Set<string> {
  const cells = new Set<string>();
  for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(width); i += 1) cells.add(`${Number(x) + i},${y}`);
  }
  return cells;
}

describe('QrCode', () => {
  it('el trazado SVG contiene exactamente los módulos oscuros de la matriz, con zona de silencio', () => {
    const matrix = qrMatrix(URI);
    const expected = new Set<string>();
    matrix.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) expected.add(`${c + QR_QUIET_ZONE},${r + QR_QUIET_ZONE}`);
      }),
    );
    expect(darkCells(qrPath(matrix, QR_QUIET_ZONE))).toEqual(expected);
  });

  it('se dibuja como imagen accesible, sin atributos style (CSP) ni HTML en bruto', () => {
    const { container } = render(<QrCode text={URI} label="QR de prueba" />);
    const svg = screen.getByRole('img', { name: 'QR de prueba' });
    const size = qrMatrix(URI).length + 2 * QR_QUIET_ZONE;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${size} ${size}`);
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelector('path')?.getAttribute('d')).not.toBe('');
  });
});
