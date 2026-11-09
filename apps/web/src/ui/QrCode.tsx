/**
 * Código QR como SVG, generado en el navegador (sin servicios externos): el contenido es la semilla
 * del TOTP y no debe salir del equipo.
 *
 * Se dibuja con elementos SVG (no con HTML en bruto ni con atributos `style`) para cumplir la CSP
 * (`style-src 'self'`). Los módulos oscuros de cada fila se agrupan en tramos para reducir el tamaño.
 */
import { QR_QUIET_ZONE, qrMatrix, type QrMatrix } from '@backoffice/shared';
import { useMemo } from 'react';

/** Trazado SVG (`d`) con un rectángulo por cada tramo horizontal de módulos oscuros. */
export function qrPath(matrix: QrMatrix, quietZone: number): string {
  const parts: string[] = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c] !== true) {
        c += 1;
        continue;
      }
      const start = c;
      while (c < row.length && row[c] === true) c += 1;
      parts.push(`M${start + quietZone} ${r + quietZone}h${c - start}v1h-${c - start}z`);
    }
  });
  return parts.join('');
}

export function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => {
    const matrix = qrMatrix(text);
    return { path: qrPath(matrix, QR_QUIET_ZONE), size: matrix.length + 2 * QR_QUIET_ZONE };
  }, [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="h-56 w-56 rounded-md border border-slate-200"
    >
      {/* Fondo blanco fijo: el QR debe ser oscuro sobre claro aunque el tema sea oscuro. */}
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
