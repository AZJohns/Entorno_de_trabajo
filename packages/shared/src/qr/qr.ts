/**
 * Códigos QR generados en local (sin servicios externos) a partir de `qrcode-generator`.
 *
 * Se usan para dar de alta el TOTP: el contenido es un `otpauth://` con la semilla, así que nunca debe
 * salir del equipo ni pasar por una librería que lo envíe a terceros (docs/dependencias.md).
 *
 * La matriz es independiente del medio: la web la dibuja como SVG y el script `user:create` como
 * bloques Unicode en la terminal.
 */
import qrcode from 'qrcode-generator';

/** Matriz cuadrada de módulos: `true` es un módulo oscuro. No incluye la zona de silencio. */
export type QrMatrix = readonly (readonly boolean[])[];

/** Zona de silencio recomendada alrededor del QR, en módulos (ISO/IEC 18004: 4). */
export const QR_QUIET_ZONE = 4;

/**
 * Codifica un texto como matriz QR, con corrección de errores de nivel M y la versión más pequeña que
 * quepa (un `otpauth://` de unos 150 caracteres da una versión 8 o menor).
 *
 * @throws {Error} si el texto no cabe en un QR (más de ~2.300 bytes con nivel M).
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_row, r) =>
    Array.from({ length: size }, (_cell, c) => qr.isDark(r, c)),
  );
}

// Colores explícitos (negro y blanco brillante): el QR debe ser oscuro sobre claro tanto en un tema
// claro como en uno oscuro de la terminal; con los colores por defecto se vería invertido.
const BLACK_FG = '\u001b[30m';
const WHITE_FG = '\u001b[97m';
const BLACK_BG = '\u001b[40m';
const WHITE_BG = '\u001b[107m';
const RESET = '\u001b[0m';

/**
 * Dibuja la matriz para una terminal con códigos ANSI. Cada carácter «▀» representa dos filas de
 * módulos (arriba: color de primer plano; abajo: color de fondo), así que el QR sale casi cuadrado y
 * ocupa la mitad de líneas. Añade la zona de silencio en blanco.
 *
 * @returns Una cadena por línea, cada una terminada con el código de reinicio de colores.
 */
export function qrToTerminalLines(matrix: QrMatrix, quietZone = QR_QUIET_ZONE): string[] {
  const size = matrix.length;
  const total = size + 2 * quietZone;
  // Fuera de la matriz (zona de silencio o fila impar sobrante) es claro.
  const dark = (row: number, col: number): boolean =>
    matrix[row - quietZone]?.[col - quietZone] === true;
  const lines: string[] = [];
  for (let row = 0; row < total; row += 2) {
    let line = '';
    for (let col = 0; col < total; col += 1) {
      line +=
        (dark(row, col) ? BLACK_FG : WHITE_FG) + (dark(row + 1, col) ? BLACK_BG : WHITE_BG) + '▀';
    }
    lines.push(line + RESET);
  }
  return lines;
}
