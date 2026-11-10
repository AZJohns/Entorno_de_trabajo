/**
 * Vista previa del Markdown de una nota como elementos de React, SIN `dangerouslySetInnerHTML`.
 *
 * Se usa solo el analizador léxico de `marked` (`marked.lexer`): devuelve tokens, no HTML. Cada token
 * se convierte aquí en un elemento de React, así que React escapa todo el texto y no existe ningún
 * punto por el que una cadena se interprete como marcado. Reglas de seguridad (docs/plan.md §2.8):
 * - El HTML que escribe el usuario (`<script>`, `<img onerror=…>`, `<div>`…) no se interpreta: se
 *   muestra tal cual, como texto.
 * - Los enlaces solo van a `http`, `https` o `mailto`; con otro esquema (`javascript:`, `data:`…) o
 *   sin esquema se muestra el texto sin enlace.
 * - Las imágenes NO se cargan: abrir una nota no debe avisar a un tercero. En su lugar se muestra el
 *   texto alternativo y, si la dirección es segura, un enlace que el propietario decide abrir.
 */
import { marked, type Token, type Tokens } from 'marked';
import { Fragment, type ReactNode } from 'react';

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/**
 * Devuelve la dirección normalizada si es un enlace permitido y `null` si no. `new URL` aplica las
 * mismas reglas que el navegador (quita tabuladores, saltos de línea y espacios iniciales, que
 * permitirían esconder `java\tscript:`) y se exige esquema explícito: no se admiten rutas relativas.
 */
export function safeHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
}

function Inline({ tokens }: { tokens: Token[] | undefined }): ReactNode {
  return (
    <>
      {(tokens ?? []).map((token, index) => (
        <Fragment key={index}>{inline(token)}</Fragment>
      ))}
    </>
  );
}

function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function inline(token: Token): ReactNode {
  switch (token.type) {
    case 'text': {
      const text = token as Tokens.Text;
      if (text.tokens !== undefined) return <Inline tokens={text.tokens} />;
      // `marked` marca como `escaped` el texto que ya trae escapado para HTML: se usa el original.
      return text.escaped === true ? text.raw : text.text;
    }
    case 'escape':
      return token.raw.slice(1);
    case 'strong':
      return (
        <strong>
          <Inline tokens={(token as Tokens.Strong).tokens} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <Inline tokens={(token as Tokens.Em).tokens} />
        </em>
      );
    case 'del':
      return (
        <del>
          <Inline tokens={(token as Tokens.Del).tokens} />
        </del>
      );
    case 'codespan':
      return (
        <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em]">
          {(token as Tokens.Codespan).text}
        </code>
      );
    case 'br':
      return <br />;
    case 'link': {
      const link = token as Tokens.Link;
      const href = safeHref(link.href);
      const label = <Inline tokens={link.tokens} />;
      if (href === null) return <span title="Enlace no permitido">{label}</span>;
      return (
        <ExternalLink href={href} className="text-blue-700 underline">
          {label}
        </ExternalLink>
      );
    }
    case 'image': {
      const image = token as Tokens.Image;
      const href = safeHref(image.href);
      const label = `[Imagen no cargada: ${image.text === '' ? 'sin descripción' : image.text}]`;
      if (href === null) return <span className="text-slate-500">{label}</span>;
      return (
        <ExternalLink href={href} className="text-slate-500 underline">
          {label}
        </ExternalLink>
      );
    }
    default:
      // `html` (etiquetas sueltas), `checkbox` y cualquier token desconocido: el texto original.
      return token.raw;
  }
}

function Cell({ cell, header }: { cell: Tokens.TableCell; header: boolean }) {
  const className = 'border border-slate-300 px-2 py-1';
  const style = cell.align === null ? undefined : { textAlign: cell.align };
  return header ? (
    <th className={className} style={style} scope="col">
      <Inline tokens={cell.tokens} />
    </th>
  ) : (
    <td className={className} style={style}>
      <Inline tokens={cell.tokens} />
    </td>
  );
}

function Blocks({ tokens }: { tokens: Token[] }): ReactNode {
  return (
    <>
      {tokens.map((token, index) => (
        <Fragment key={index}>{block(token)}</Fragment>
      ))}
    </>
  );
}

function block(token: Token): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    case 'heading': {
      const heading = token as Tokens.Heading;
      // La pantalla ya usa h1 y h2: los títulos de la nota empiezan en h3.
      const Tag = `h${String(Math.min(heading.depth + 2, 6))}` as 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag className="mt-3 font-semibold">
          <Inline tokens={heading.tokens} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="my-2">
          <Inline tokens={(token as Tokens.Paragraph).tokens} />
        </p>
      );
    case 'text': {
      // Texto suelto dentro de un elemento de lista.
      const text = token as Tokens.Text;
      return text.tokens === undefined ? token.raw : <Inline tokens={text.tokens} />;
    }
    case 'blockquote':
      return (
        <blockquote className="my-2 border-l-4 border-slate-300 pl-3 text-slate-600">
          <Blocks tokens={(token as Tokens.Blockquote).tokens} />
        </blockquote>
      );
    case 'code':
      return (
        <pre className="my-2 overflow-x-auto rounded bg-slate-100 p-3 text-sm">
          <code>{(token as Tokens.Code).text}</code>
        </pre>
      );
    case 'hr':
      return <hr className="my-3 border-slate-300" />;
    case 'list': {
      const list = token as Tokens.List;
      const Tag = list.ordered ? 'ol' : 'ul';
      return (
        <Tag
          className={`my-2 ml-6 ${list.ordered ? 'list-decimal' : 'list-disc'}`}
          start={list.ordered && list.start !== '' ? list.start : undefined}
        >
          {list.items.map((item, index) => (
            <li key={index}>
              {item.task && (
                <input
                  type="checkbox"
                  checked={item.checked === true}
                  disabled
                  readOnly
                  aria-label={item.checked === true ? 'Hecha' : 'Pendiente'}
                  className="mr-1"
                />
              )}
              <Blocks tokens={item.tokens.filter((t) => t.type !== 'checkbox')} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'table': {
      const table = token as Tokens.Table;
      return (
        <div className="my-2 overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <Cell key={index} cell={cell} header />
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <Cell key={index} cell={cell} header={false} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      // `html` de bloque y tokens desconocidos: texto, conservando los saltos de línea.
      return <p className="my-2 whitespace-pre-wrap">{token.raw}</p>;
  }
}

/** Vista previa segura de un texto en Markdown. */
export function MarkdownPreview({ source }: { source: string }) {
  if (source.trim() === '') return <p className="text-sm text-slate-500">Nada que mostrar.</p>;
  return (
    <div className="break-words text-slate-800">
      <Blocks tokens={marked.lexer(source)} />
    </div>
  );
}
