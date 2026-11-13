/**
 * Lector mínimo de ZIP en memoria para los archivos `.xlsx` (docs/plantilla-excel.md §2; ASVS 5.2.3).
 *
 * Por qué propio y no una librería: la protección contra *zip bombs* exige limitar lo que **realmente** se
 * descomprime, y los tamaños que declara el archivo los controla quien lo sube. Aquí se limita de tres
 * maneras: (1) el número de entradas se comprueba antes de leer el directorio central; (2) la suma de los
 * tamaños declarados se comprueba antes de descomprimir nada; (3) cada entrada se descomprime con
 * `maxOutputLength` de `node:zlib`, así que una entrada que miente sobre su tamaño se corta al llegar al
 * límite en vez de agotar la memoria. Solo se descomprimen las entradas que el lector pide (nunca
 * `docProps/`, comentarios ni imágenes).
 *
 * No admite ZIP64, cifrado ni más métodos que *stored* (0) y *deflate* (8): ningún `.xlsx` legítimo de
 * 5 MB los necesita. Nada se escribe en disco ni se ejecuta.
 */
import { crc32, inflateRawSync } from 'node:zlib';

/** El archivo no es un ZIP válido o usa algo no admitido. → `FILE_NOT_OOXML` */
export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

/** Se superó un límite de entradas o de tamaño descomprimido. → `FILE_ZIP_LIMITS` */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

export interface ZipLimits {
  /** Número máximo de entradas del archivo. */
  readonly maxEntries: number;
  /** Máximo de bytes descomprimidos: suma declarada y suma real. */
  readonly maxUncompressedBytes: number;
}

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const CENTRAL_FIXED = 46;
const LOCAL_FIXED = 30;
const UINT32_MAX = 0xffffffff;
const UINT16_MAX = 0xffff;

/** Archivo ZIP abierto: el directorio central ya está leído y validado; el contenido aún no. */
export class ZipArchive {
  readonly #buffer: Buffer;
  readonly #entries: Map<string, ZipEntry>;
  readonly #limits: ZipLimits;
  readonly #cache = new Map<string, Buffer>();
  #decompressed = 0;

  constructor(buffer: Buffer, entries: Map<string, ZipEntry>, limits: ZipLimits) {
    this.#buffer = buffer;
    this.#entries = entries;
    this.#limits = limits;
  }

  /** Nombres de todas las entradas, tal cual vienen en el archivo. */
  names(): string[] {
    return [...this.#entries.keys()];
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** Bytes realmente descomprimidos hasta ahora (para los tests). */
  get decompressedBytes(): number {
    return this.#decompressed;
  }

  /**
   * Descomprime una entrada con el presupuesto que queda. Comprueba que el tamaño real y el CRC-32
   * coinciden con lo declarado. Devuelve `undefined` si la entrada no existe.
   */
  read(name: string): Buffer | undefined {
    const cached = this.#cache.get(name);
    if (cached !== undefined) return cached;
    const entry = this.#entries.get(name);
    if (entry === undefined) return undefined;

    const dataStart = this.#dataStart(entry);
    const compressed = this.#buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (compressed.length !== entry.compressedSize) {
      throw new ZipFormatError('Una entrada del ZIP está truncada');
    }
    const budget = this.#limits.maxUncompressedBytes - this.#decompressed;
    let data: Buffer;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        throw new ZipFormatError('Tamaño inconsistente en una entrada sin comprimir');
      }
      data = compressed;
    } else {
      try {
        // `maxOutputLength`: corta la descompresión al superar el presupuesto, no después.
        data = inflateRawSync(compressed, { maxOutputLength: Math.max(budget, 1) });
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new ZipLimitError('El contenido descomprimido supera el límite');
        }
        throw new ZipFormatError('Datos comprimidos no válidos');
      }
    }
    if (data.length > budget)
      throw new ZipLimitError('El contenido descomprimido supera el límite');
    if (data.length !== entry.uncompressedSize) {
      throw new ZipFormatError('El tamaño real no coincide con el declarado');
    }
    if (crc32(data) !== entry.crc32) throw new ZipFormatError('CRC-32 incorrecto');
    this.#decompressed += data.length;
    this.#cache.set(name, data);
    return data;
  }

  /** Posición de los datos: tras la cabecera local, cuyos campos de longitud pueden diferir del directorio. */
  #dataStart(entry: ZipEntry): number {
    const at = entry.localHeaderOffset;
    if (
      at + LOCAL_FIXED > this.#buffer.length ||
      this.#buffer.readUInt32LE(at) !== LOCAL_SIGNATURE
    ) {
      throw new ZipFormatError('Cabecera local no válida');
    }
    return (
      at + LOCAL_FIXED + this.#buffer.readUInt16LE(at + 26) + this.#buffer.readUInt16LE(at + 28)
    );
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // El registro final puede ir seguido de un comentario de hasta 65 535 bytes.
  const lowest = Math.max(0, buffer.length - EOCD_MIN - UINT16_MAX);
  for (let at = buffer.length - EOCD_MIN; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new ZipFormatError('No es un ZIP: falta el registro final');
}

/**
 * Abre un ZIP y valida su directorio central: número de entradas y tamaño declarado total (antes de
 * descomprimir nada), nombres únicos, métodos admitidos y sin cifrado.
 *
 * @throws {ZipFormatError} si no es un ZIP válido o usa ZIP64, cifrado o un método no admitido.
 * @throws {ZipLimitError} si supera `maxEntries` o `maxUncompressedBytes` (declarado).
 */
export function openZip(buffer: Buffer, limits: ZipLimits): ZipArchive {
  if (buffer.length < EOCD_MIN) throw new ZipFormatError('Archivo demasiado corto para ser un ZIP');
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === UINT16_MAX || directorySize === UINT32_MAX || directoryOffset === UINT32_MAX) {
    throw new ZipLimitError('ZIP64 no admitido');
  }
  // Se rechaza ANTES de leer el directorio: un ZIP con millones de entradas no llega a recorrerse.
  if (entryCount > limits.maxEntries) {
    throw new ZipLimitError(`Más de ${String(limits.maxEntries)} entradas`);
  }
  if (directoryOffset + directorySize > eocd)
    throw new ZipFormatError('Directorio central fuera de rango');

  const entries = new Map<string, ZipEntry>();
  let declaredTotal = 0;
  let at = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (at + CENTRAL_FIXED > eocd || buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError('Entrada del directorio central no válida');
    }
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const entry = {
      method,
      crc32: buffer.readUInt32LE(at + 16),
      compressedSize: buffer.readUInt32LE(at + 20),
      uncompressedSize: buffer.readUInt32LE(at + 24),
      localHeaderOffset: buffer.readUInt32LE(at + 42),
    };
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const next = at + CENTRAL_FIXED + nameLength + extraLength + commentLength;
    if (next > eocd) throw new ZipFormatError('Entrada del directorio central truncada');
    const name = buffer.toString('utf8', at + CENTRAL_FIXED, at + CENTRAL_FIXED + nameLength);

    if ((flags & 0x1) !== 0) throw new ZipFormatError('ZIP cifrado no admitido');
    if (method !== 0 && method !== 8) throw new ZipFormatError('Método de compresión no admitido');
    if (entry.compressedSize === UINT32_MAX || entry.uncompressedSize === UINT32_MAX) {
      throw new ZipLimitError('ZIP64 no admitido');
    }
    // Un nombre repetido es ambiguo (qué entrada lee cada herramienta): se rechaza.
    if (entries.has(name)) throw new ZipFormatError('Entradas con el mismo nombre');
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > limits.maxUncompressedBytes) {
      throw new ZipLimitError('El tamaño descomprimido declarado supera el límite');
    }
    entries.set(name, { name, ...entry });
    at = next;
  }
  return new ZipArchive(buffer, entries, limits);
}
