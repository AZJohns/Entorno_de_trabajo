/**
 * Analizador XML estricto y mínimo para las partes de un `.xlsx` (ASVS 5.2.3, 1.5.1).
 *
 * Diseñado para ser inatacable por construcción, no por configuración:
 * - **Rechaza `<!DOCTYPE` y `<!ENTITY`** (cualquier `<!` que no sea un comentario o CDATA). Sin DTD no hay
 *   entidades externas (XXE) ni expansión de entidades («billion laughs»).
 * - Solo resuelve las cinco entidades predefinidas y las referencias numéricas; cualquier otra `&…;`
 *   es un error, no se expande.
 * - Profundidad máxima fija, sin recursión: es un recorrido por posición con una pila acotada.
 * - No accede a la red ni al disco, ni evalúa nada.
 *
 * Es SAX: avisa de cada apertura, texto y cierre. Los nombres de elemento se entregan sin prefijo de
 * espacio de nombres (`x:row` → `row`); los de atributo se entregan completos (`r:id`).
 */

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlHandler {
  open(name: string, attributes: Readonly<Record<string, string>>): void;
  text(text: string): void;
  close(name: string): void;
}

const MAX_DEPTH = 64;
const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** Sustituye las entidades predefinidas y numéricas. Cualquier otra referencia es un error. */
function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/gu, (_whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x')
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!isXmlChar(code)) throw new XmlError('Referencia numérica no válida');
      return String.fromCodePoint(code);
    }
    const value = ENTITIES[body];
    if (value === undefined) throw new XmlError('Entidad no admitida');
    return value;
  });
}

function assertNoStrayAmpersand(raw: string): void {
  // Tras decodificar, un `&` que sobreviva solo puede venir de `&amp;`. Se comprueba sobre el texto
  // original: cada `&` tiene que ser el inicio de una referencia completa.
  if (/&(?!(?:#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);)/u.test(raw)) {
    throw new XmlError('Referencia a entidad mal formada');
  }
}

function decode(raw: string): string {
  assertNoStrayAmpersand(raw);
  return decodeEntities(raw);
}

const NAME_END = /[\s/>]/u;

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * Recorre el documento llamando al manejador.
 *
 * @throws {XmlError} si está mal formado, usa DTD o entidades no predefinidas o supera la profundidad.
 */
export function parseXml(xml: string, handler: XmlHandler): void {
  const length = xml.length;
  const stack: string[] = [];
  let index = 0;
  let rootSeen = false;

  while (index < length) {
    const lt = xml.indexOf('<', index);
    if (lt === -1) {
      if (xml.slice(index).trim() !== '') throw new XmlError('Texto fuera del elemento raíz');
      break;
    }
    if (lt > index) {
      const raw = xml.slice(index, lt);
      if (stack.length === 0) {
        if (raw.trim() !== '') throw new XmlError('Texto fuera del elemento raíz');
      } else {
        handler.text(decode(raw));
      }
    }

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlError('Comentario sin cerrar');
      index = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1 || stack.length === 0) throw new XmlError('CDATA no válido');
      handler.text(xml.slice(lt + 9, end));
      index = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) throw new XmlError('Instrucción sin cerrar');
      index = end + 2;
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE, ENTITY, ELEMENT, ATTLIST…: nunca.
      throw new XmlError('Las declaraciones DTD no están permitidas');
    } else if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) throw new XmlError('Etiqueta de cierre sin terminar');
      const name = localName(xml.slice(lt + 2, end).trim());
      if (stack.pop() !== name) throw new XmlError('Etiquetas mal anidadas');
      handler.close(name);
      index = end + 1;
    } else {
      if (stack.length === 0) {
        if (rootSeen) throw new XmlError('Más de un elemento raíz');
        rootSeen = true;
      }
      index = parseStartTag(xml, lt + 1, stack, handler);
    }
  }
  if (stack.length > 0) throw new XmlError('Elemento sin cerrar');
  if (!rootSeen) throw new XmlError('Documento vacío');
}

/** Lee `<nombre attr="v" …>` o `<nombre …/>` desde `start` (justo tras `<`). Devuelve la posición siguiente. */
function parseStartTag(xml: string, start: number, stack: string[], handler: XmlHandler): number {
  let cursor = start;
  while (cursor < xml.length && !NAME_END.test(xml[cursor] ?? '')) cursor += 1;
  const rawName = xml.slice(start, cursor);
  if (rawName === '') throw new XmlError('Etiqueta sin nombre');
  const name = localName(rawName);
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;

  for (;;) {
    while (cursor < xml.length && /\s/u.test(xml[cursor] ?? '')) cursor += 1;
    const char = xml[cursor];
    if (char === undefined) throw new XmlError('Etiqueta sin terminar');
    if (char === '>' || char === '/') break;
    const nameStart = cursor;
    while (cursor < xml.length && !/[\s=/>]/u.test(xml[cursor] ?? '')) cursor += 1;
    const attributeName = xml.slice(nameStart, cursor);
    while (cursor < xml.length && /\s/u.test(xml[cursor] ?? '')) cursor += 1;
    if (attributeName === '' || xml[cursor] !== '=') throw new XmlError('Atributo mal formado');
    cursor += 1;
    while (cursor < xml.length && /\s/u.test(xml[cursor] ?? '')) cursor += 1;
    const quote = xml[cursor];
    if (quote !== '"' && quote !== "'") throw new XmlError('Valor de atributo sin comillas');
    const valueEnd = xml.indexOf(quote, cursor + 1);
    if (valueEnd === -1) throw new XmlError('Valor de atributo sin cerrar');
    const rawValue = xml.slice(cursor + 1, valueEnd);
    if (rawValue.includes('<')) throw new XmlError('«<» en un valor de atributo');
    if (attributeName in attributes) throw new XmlError('Atributo repetido');
    attributes[attributeName] = decode(rawValue);
    cursor = valueEnd + 1;
  }

  let selfClosing = false;
  if (xml[cursor] === '/') {
    selfClosing = true;
    cursor += 1;
  }
  if (xml[cursor] !== '>') throw new XmlError('Etiqueta mal terminada');

  if (stack.length >= MAX_DEPTH) throw new XmlError('Anidamiento excesivo');
  handler.open(name, attributes);
  if (selfClosing) {
    handler.close(name);
  } else {
    stack.push(name);
  }
  return cursor + 1;
}

/**
 * Decodifica los escapes `_xHHHH_` de OOXML en el texto de las celdas (p. ej. `_x000D_` = retorno de
 * carro). Un `_x005F_` es un guion bajo literal.
 */
export function decodeOoxmlEscapes(text: string): string {
  if (!text.includes('_x')) return text;
  return text.replace(/_x([0-9a-fA-F]{4})_/gu, (_whole, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}
