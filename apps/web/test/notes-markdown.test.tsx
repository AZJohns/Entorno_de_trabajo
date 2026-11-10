// @vitest-environment jsdom
/**
 * Vista previa del Markdown: XSS. Lo que escribe el usuario nunca llega al DOM como elemento activo:
 * HTML crudo como texto, enlaces solo http/https/mailto e imágenes sin cargar.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownPreview, safeHref } from '../src/notes/markdown.tsx';

afterEach(cleanup);

function preview(source: string): HTMLElement {
  const { container } = render(<MarkdownPreview source={source} />);
  return container;
}

/** Elementos que serían peligrosos si el contenido se hubiera interpretado como HTML. */
const DANGEROUS =
  'script, img, iframe, object, embed, style, svg, form, [onerror], [onclick], [onload]';

describe('HTML crudo: se muestra como texto', () => {
  it('<script> queda inerte y visible', () => {
    const dom = preview('Antes <script>alert(1)</script> después');
    expect(dom.querySelector('script')).toBeNull();
    expect(dom.textContent).toContain('<script>');
    expect(dom.textContent).toContain('alert(1)');
    expect(dom.textContent).toContain('</script>');
  });

  it('<img src=x onerror=…> no crea ninguna imagen ni atributo de evento', () => {
    const dom = preview('<img src=x onerror=alert(1)>');
    expect(dom.querySelector(DANGEROUS)).toBeNull();
    expect(dom.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('un bloque HTML (<div onclick>, <iframe>, <style>) sale como texto', () => {
    const dom = preview(
      '<div onclick="alert(1)">hola</div>\n\n<iframe src="https://malo.example"></iframe>\n\n<style>body{display:none}</style>',
    );
    expect(dom.querySelector(DANGEROUS)).toBeNull();
    expect(dom.querySelector('div[onclick]')).toBeNull();
    expect(dom.textContent).toContain('<div onclick="alert(1)">hola</div>');
    expect(dom.textContent).toContain('<iframe src="https://malo.example"></iframe>');
    expect(dom.textContent).toContain('<style>body{display:none}</style>');
  });

  it('el HTML dentro de un bloque de código y de un código en línea también es texto', () => {
    const dom = preview('`<b>x</b>`\n\n```\n<script>alert(2)</script>\n```');
    expect(dom.querySelector('script, b')).toBeNull();
    expect(dom.querySelectorAll('code')).toHaveLength(2);
    expect(dom.textContent).toContain('<b>x</b>');
    expect(dom.textContent).toContain('<script>alert(2)</script>');
  });

  it('el HTML dentro de un título, una cita, una lista y una tabla no se interpreta', () => {
    const dom = preview(
      '# <img src=x onerror=1>\n\n> <script>1</script>\n\n- <b onmouseover=1>a</b>\n\n| h |\n|---|\n| <img src=y onerror=2> |',
    );
    expect(dom.querySelector(DANGEROUS)).toBeNull();
    expect(dom.querySelector('b')).toBeNull();
  });

  it('el texto con entidades y símbolos se muestra literal, sin doble interpretación', () => {
    const dom = preview('a < b & c &lt;script&gt;');
    expect(dom.querySelector('script')).toBeNull();
    expect(dom.textContent).toContain('a < b & c &lt;script&gt;');
  });
});

describe('enlaces', () => {
  it('javascript: queda sin enlace', () => {
    const dom = preview('[pulsa](javascript:alert(1))');
    expect(dom.querySelector('a')).toBeNull();
    expect(dom.querySelector('[href]')).toBeNull();
    expect(dom.textContent).toContain('pulsa');
  });

  it.each([
    ['mayúsculas', '[x](JaVaScRiPt:alert(1))'],
    ['con un tabulador dentro', '[x](java&#9;script:alert(1))'],
    ['data:', '[x](data:text/html;base64,PHNjcmlwdD4=)'],
    ['vbscript:', '[x](vbscript:msgbox(1))'],
    ['sin esquema (ruta relativa)', '[x](/ajustes/seguridad)'],
    ['a través de una referencia', '[x][r]\n\n[r]: javascript:alert(1)'],
    ['autoenlace de javascript:', '<javascript:alert(1)>'],
  ])('%s: ningún <a> con destino peligroso', (_name, source) => {
    const dom = preview(source);
    for (const a of dom.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').toMatch(/^(https?:|mailto:)/u);
    }
  });

  it.each(['https://ejemplo.org/ruta?a=1', 'http://ejemplo.org', 'mailto:alguien@ejemplo.org'])(
    '%s sí es un enlace, con rel noopener noreferrer',
    (url) => {
      const dom = preview(`[ir](${url})`);
      const a = dom.querySelector('a');
      expect(a).not.toBeNull();
      expect(a?.getAttribute('href')).toBe(new URL(url).href);
      expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a?.getAttribute('target')).toBe('_blank');
    },
  );

  it('un autoenlace http también lleva rel', () => {
    const a = preview('Mira <https://ejemplo.org/x>').querySelector('a');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('safeHref solo admite http, https y mailto con esquema explícito', () => {
    expect(safeHref('https://a.org')).toBe('https://a.org/');
    expect(safeHref('  https://a.org  ')).toBe('https://a.org/');
    expect(safeHref('mailto:a@b.org')).toBe('mailto:a@b.org');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'ftp://a',
      '//a.org',
      '/ruta',
      '',
      'java\tscript:alert(1)',
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe('imágenes: no se cargan', () => {
  it('una imagen externa no crea <img> y muestra un enlace', () => {
    const dom = preview('![logo](https://rastreador.example/pixel.png)');
    expect(dom.querySelector('img')).toBeNull();
    const a = dom.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://rastreador.example/pixel.png');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a?.textContent).toContain('logo');
  });

  it('una imagen con dirección peligrosa o data: no crea <img> ni enlace', () => {
    const dom = preview('![a](javascript:alert(1)) ![b](data:image/svg+xml;base64,PHN2Zz4=)');
    expect(dom.querySelector('img, a, [src], [href]')).toBeNull();
    expect(dom.textContent).toContain('Imagen no cargada');
  });

  it('el texto alternativo con HTML sale como texto', () => {
    const dom = preview('![<script>x</script>](https://e.org/a.png)');
    expect(dom.querySelector('script, img')).toBeNull();
  });
});

describe('Markdown normal', () => {
  it('pinta títulos (desde h3), énfasis, listas, citas, código y tablas', () => {
    const dom = preview(
      '# Uno\n\n**negrita** y *cursiva* y ~~tachado~~\n\n1. a\n2. b\n\n- [x] hecha\n- [ ] pendiente\n\n> cita\n\n| h1 | h2 |\n|----|----|\n| a | b |',
    );
    expect(dom.querySelector('h3')?.textContent).toBe('Uno');
    expect(dom.querySelector('strong')?.textContent).toBe('negrita');
    expect(dom.querySelector('em')?.textContent).toBe('cursiva');
    expect(dom.querySelector('del')?.textContent).toBe('tachado');
    expect(dom.querySelectorAll('ol li')).toHaveLength(2);
    expect(dom.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(dom.querySelector('blockquote')?.textContent).toContain('cita');
    expect(dom.querySelectorAll('th')).toHaveLength(2);
    expect(dom.querySelectorAll('td')).toHaveLength(2);
  });

  it('un texto vacío avisa en lugar de dejar el panel en blanco', () => {
    expect(preview('   ').textContent).toBe('Nada que mostrar.');
  });
});
