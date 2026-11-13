/**
 * Lector de ZIP (ASVS 5.2.3): límites de entradas y de tamaño descomprimido ANTES de descomprimir, y corte
 * de una entrada que miente sobre su tamaño. Incluye un *zip bomb* sintético.
 */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { openZip, ZipFormatError, ZipLimitError } from '../../src/modules/imports/domain/zip.ts';
import { buildZip } from '../fixtures/xlsx-builder.ts';

const LIMITS = { maxEntries: 10, maxUncompressedBytes: 1000 };
const text = (value: string): Buffer => Buffer.from(value, 'utf8');

describe('openZip', () => {
  it('lee entradas comprimidas y sin comprimir y comprueba su CRC', () => {
    const zip = buildZip([
      { name: 'a.txt', data: text('hola') },
      { name: 'b.txt', data: text('mundo'), method: 'store' },
    ]);
    const archive = openZip(zip, LIMITS);
    expect(archive.names()).toEqual(['a.txt', 'b.txt']);
    expect(archive.read('a.txt')?.toString()).toBe('hola');
    expect(archive.read('b.txt')?.toString()).toBe('mundo');
    expect(archive.read('no-existe')).toBeUndefined();
  });

  it('rechaza por número de entradas ANTES de recorrer el directorio central', () => {
    const files = Array.from({ length: 11 }, (_, index) => ({
      name: `f${String(index)}`,
      data: text('x'),
    }));
    expect(() => openZip(buildZip(files), LIMITS)).toThrow(ZipLimitError);
  });

  it('rechaza por la suma de tamaños DECLARADOS antes de descomprimir nada', () => {
    const zip = buildZip([
      { name: 'a', data: text('x'), declaredUncompressedSize: 600 },
      { name: 'b', data: text('x'), declaredUncompressedSize: 600 },
    ]);
    expect(() => openZip(zip, LIMITS)).toThrow(ZipLimitError);
  });

  it('corta una entrada que miente sobre su tamaño: no se descomprime más de lo permitido', () => {
    // Declara 10 bytes pero en realidad descomprime 5000 (de ceros): el límite real es 1000.
    const zip = buildZip([
      { name: 'bomba', data: Buffer.alloc(5000), declaredUncompressedSize: 10 },
    ]);
    const archive = openZip(zip, LIMITS);
    expect(() => archive.read('bomba')).toThrow(ZipLimitError);
    expect(archive.decompressedBytes).toBe(0);
  });

  it('un zip bomb sintético de 60 MB de ceros (pocos KB comprimidos) no llega a descomprimirse entero', () => {
    const zeros = Buffer.alloc(60 * 1024 * 1024);
    const compressed = deflateRawSync(zeros);
    expect(compressed.length).toBeLessThan(200 * 1024);
    const zip = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: zeros }]);
    expect(zip.length).toBeLessThan(200 * 1024);
    // Con el tamaño honesto se rechaza por la suma declarada (50 MB), sin descomprimir.
    expect(() => openZip(zip, { maxEntries: 200, maxUncompressedBytes: 50 * 1024 * 1024 })).toThrow(
      ZipLimitError,
    );
  });

  it('el presupuesto de bytes descomprimidos es común a todas las entradas leídas', () => {
    const zip = buildZip([
      { name: 'a', data: Buffer.alloc(600, 1) },
      { name: 'b', data: Buffer.alloc(600, 2) },
    ]);
    // Cada una cabe sola (600 ≤ 1000) y la suma declarada (1200) ya supera el límite.
    expect(() => openZip(zip, LIMITS)).toThrow(ZipLimitError);
    const archive = openZip(zip, { maxEntries: 10, maxUncompressedBytes: 1300 });
    archive.read('a');
    expect(archive.decompressedBytes).toBe(600);
    archive.read('a'); // una entrada ya leída no vuelve a contar
    expect(archive.decompressedBytes).toBe(600);
  });

  it('rechaza un CRC incorrecto', () => {
    const zip = buildZip([{ name: 'a', data: text('hola'), crc: 123 }]);
    expect(() => openZip(zip, LIMITS).read('a')).toThrow(ZipFormatError);
  });

  it('rechaza nombres de entrada repetidos (ambiguos)', () => {
    const zip = buildZip([
      { name: 'a', data: text('1') },
      { name: 'a', data: text('2') },
    ]);
    expect(() => openZip(zip, LIMITS)).toThrow(ZipFormatError);
  });

  it('rechaza lo que no es un ZIP, un ZIP truncado y un ZIP cifrado', () => {
    expect(() => openZip(Buffer.from('no soy un zip, ni de lejos'), LIMITS)).toThrow(
      ZipFormatError,
    );
    expect(() => openZip(Buffer.alloc(3), LIMITS)).toThrow(ZipFormatError);
    const zip = buildZip([{ name: 'a', data: text('hola') }]);
    expect(() => openZip(zip.subarray(0, zip.length - 30), LIMITS)).toThrow(ZipFormatError);
    // Bit 0 de las banderas del directorio central = cifrado.
    const encrypted = Buffer.from(zip);
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    expect(() => openZip(encrypted, LIMITS)).toThrow(ZipFormatError);
  });

  it('rechaza un método de compresión que no sea el 0 ni el 8', () => {
    const zip = Buffer.from(buildZip([{ name: 'a', data: text('hola') }]));
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt16LE(12, central + 10); // bzip2
    expect(() => openZip(zip, LIMITS)).toThrow(ZipFormatError);
  });

  it('rechaza ZIP64 (ningún .xlsx de 5 MB lo necesita)', () => {
    const zip = Buffer.from(buildZip([{ name: 'a', data: text('hola') }]));
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    zip.writeUInt16LE(0xffff, end + 10);
    expect(() => openZip(zip, LIMITS)).toThrow(ZipLimitError);
  });
});
