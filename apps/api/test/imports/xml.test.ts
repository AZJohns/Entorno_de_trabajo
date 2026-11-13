/**
 * Analizador XML estricto: sin DTD ni entidades externas (XXE), sin expansión de entidades («billion
 * laughs») y con profundidad limitada.
 */
import { describe, expect, it } from 'vitest';
import { decodeOoxmlEscapes, parseXml, XmlError } from '../../src/modules/imports/domain/xml.ts';

/** Devuelve la lista de eventos para comparar. */
function events(xml: string): string[] {
  const out: string[] = [];
  parseXml(xml, {
    open: (name, attributes) => out.push(`<${name} ${JSON.stringify(attributes)}>`),
    text: (text) => out.push(`#${text}`),
    close: (name) => out.push(`</${name}>`),
  });
  return out;
}

describe('parseXml', () => {
  it('lee elementos, atributos y texto; quita los prefijos de espacio de nombres de los elementos', () => {
    expect(
      events(
        '<?xml version="1.0"?><x:a xmlns:x="u" r:id="rId1" b=\'2\'><x:c>hola &amp; &lt;adiós&gt; &#65;&#x42;</x:c><d/></x:a>',
      ),
    ).toEqual([
      '<a {"xmlns:x":"u","r:id":"rId1","b":"2"}>',
      '<c {}>',
      '#hola & <adiós> AB',
      '</c>',
      '<d {}>',
      '</d>',
      '</a>',
    ]);
  });

  it('admite comentarios y CDATA', () => {
    expect(events('<a><!-- nota --><![CDATA[<b> & c]]></a>')).toEqual([
      '<a {}>',
      '#<b> & c',
      '</a>',
    ]);
  });

  it('rechaza DOCTYPE y entidades definidas en el documento (XXE)', () => {
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>';
    expect(() => events(xxe)).toThrow(XmlError);
    expect(() => events(xxe)).toThrow(/DTD/u);
  });

  it('rechaza una bomba de expansión de entidades («billion laughs») sin expandir nada', () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    expect(() => events(bomb)).toThrow(XmlError);
  });

  it('rechaza entidades no predefinidas y referencias mal formadas, también sin DTD', () => {
    expect(() => events('<a>&x;</a>')).toThrow(XmlError);
    expect(() => events('<a>a & b</a>')).toThrow(XmlError);
    expect(() => events('<a>&#0;</a>')).toThrow(XmlError);
    expect(() => events('<a x="&desconocida;"/>')).toThrow(XmlError);
  });

  it('rechaza XML mal formado', () => {
    for (const bad of [
      '<a>',
      '<a></b>',
      '<a><b></a></b>',
      '<a x=1/>',
      '<a x="1" x="2"/>',
      '<a x="<"/>',
      '<a/><b/>',
      'texto fuera',
      '',
      '<a><![CDATA[sin cerrar</a>',
      '<a><!-- sin cerrar</a>',
    ]) {
      expect(() => events(bad), bad).toThrow(XmlError);
    }
  });

  it('limita la profundidad (sin recursión)', () => {
    const deep = `${'<a>'.repeat(200)}${'</a>'.repeat(200)}`;
    expect(() => events(deep)).toThrow(/Anidamiento/u);
  });

  it('un documento enorme de elementos planos se recorre sin problemas', () => {
    const xml = `<a>${'<b>1</b>'.repeat(50_000)}</a>`;
    let opened = 0;
    parseXml(xml, { open: () => (opened += 1), text: () => undefined, close: () => undefined });
    expect(opened).toBe(50_001);
  });
});

describe('decodeOoxmlEscapes', () => {
  it('decodifica _xHHHH_ y deja el resto', () => {
    expect(decodeOoxmlEscapes('a_x000D_b_x005F_c')).toBe('a\rb_c');
    expect(decodeOoxmlEscapes('sin escapes_x_')).toBe('sin escapes_x_');
  });
});
