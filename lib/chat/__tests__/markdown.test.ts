import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MARKDOWN_ELEMENTS,
  ALLOWED_URL_SCHEMES,
  MAX_MARKDOWN_CHARS,
  clampMarkdownLength,
  limitNestingDepth,
  prepareChatMarkdown,
  sanitizeChatUrl,
} from '../markdown';

/**
 * Pruebas de la política de render del Markdown del chat.
 *
 * Es la superficie de ataque real del módulo: el texto lo escribe un modelo de
 * lenguaje que lee correos y tickets, así que "lo que el mensaje pida" no puede
 * decidir qué se ejecuta en el navegador de quien lo lee.
 */
describe('sanitizeChatUrl', () => {
  it('acepta los esquemas de la lista blanca', () => {
    expect(sanitizeChatUrl('https://gsslatam.com')).toBe('https://gsslatam.com');
    expect(sanitizeChatUrl('http://192.168.10.5:3030')).toBe('http://192.168.10.5:3030');
    expect(sanitizeChatUrl('mailto:nicolas.rivera@gsslatam.com')).toBe(
      'mailto:nicolas.rivera@gsslatam.com'
    );
    expect(sanitizeChatUrl('tel:+573001112233')).toBe('tel:+573001112233');
  });

  it('descarta javascript:, data: y demás esquemas ejecutables', () => {
    expect(sanitizeChatUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeChatUrl('JavaScript:alert(1)')).toBe('');
    expect(sanitizeChatUrl('vbscript:msgbox(1)')).toBe('');
    expect(sanitizeChatUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(sanitizeChatUrl('file:///C:/Windows/System32')).toBe('');
  });

  it('no se deja engañar por espacios y caracteres de control dentro del esquema', () => {
    expect(sanitizeChatUrl('java\tscript:alert(1)')).toBe('');
    expect(sanitizeChatUrl('java\nscript:alert(1)')).toBe('');
    expect(sanitizeChatUrl('  javascript:alert(1)')).toBe('');
    expect(sanitizeChatUrl('java\u0000script:alert(1)')).toBe('');
    expect(sanitizeChatUrl('\u0001javascript:alert(1)')).toBe('');
  });

  it('deja pasar rutas relativas de la propia aplicación', () => {
    expect(sanitizeChatUrl('/process/chat')).toBe('/process/chat');
    expect(sanitizeChatUrl('#seccion')).toBe('#seccion');
    expect(sanitizeChatUrl('./detalle')).toBe('./detalle');
  });

  it('bloquea la URL protocolo-relativa disfrazada de ruta', () => {
    expect(sanitizeChatUrl('//evil.example.com/x')).toBe('');
  });

  it('trata lo vacío y lo que no es texto como sin enlace', () => {
    expect(sanitizeChatUrl('')).toBe('');
    expect(sanitizeChatUrl('   ')).toBe('');
    expect(sanitizeChatUrl(null)).toBe('');
    expect(sanitizeChatUrl(undefined)).toBe('');
    expect(sanitizeChatUrl(42 as unknown as string)).toBe('');
  });
});

describe('listas blancas', () => {
  it('no incluye elementos que carguen recursos remotos ni ejecuten código', () => {
    const prohibidos = ['img', 'script', 'iframe', 'video', 'audio', 'object', 'embed', 'svg', 'style', 'input'];
    for (const tag of prohibidos) {
      expect(ALLOWED_MARKDOWN_ELEMENTS as readonly string[]).not.toContain(tag);
    }
  });

  it('incluye lo que el chat sí necesita pintar', () => {
    for (const tag of ['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'table', 'br']) {
      expect(ALLOWED_MARKDOWN_ELEMENTS as readonly string[]).toContain(tag);
    }
  });

  it('la lista de esquemas es exactamente la acordada', () => {
    expect([...ALLOWED_URL_SCHEMES]).toEqual(['http', 'https', 'mailto', 'tel']);
  });
});

describe('clampMarkdownLength', () => {
  it('deja intacto lo que cabe', () => {
    const r = clampMarkdownLength('hola **mundo**');
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('hola **mundo**');
  });

  it('recorta y avisa cuando se pasa del tope', () => {
    const r = clampMarkdownLength('a'.repeat(MAX_MARKDOWN_CHARS + 500));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(MAX_MARKDOWN_CHARS + 100);
    expect(r.text).toContain('recortado');
  });
});

describe('limitNestingDepth', () => {
  it('recorta las citas encadenadas al tope', () => {
    const out = limitNestingDepth('> '.repeat(50) + 'texto', 3);
    expect((out.match(/>/g) ?? []).length).toBe(3);
    expect(out).toContain('texto');
  });

  it('recorta la sangría desbordada de las listas', () => {
    const out = limitNestingDepth(' '.repeat(400) + '- item', 4);
    expect(out.startsWith(' '.repeat(8) + '- item')).toBe(true);
  });

  it('no toca la sangría dentro de un bloque de código cercado', () => {
    const md = ['```', ' '.repeat(20) + 'const x = 1;', '```'].join('\n');
    expect(limitNestingDepth(md, 2)).toBe(md);
  });
});

describe('prepareChatMarkdown', () => {
  it('devuelve vacío para un cuerpo vacío', () => {
    expect(prepareChatMarkdown('   ')).toEqual({ text: '', truncated: false });
    expect(prepareChatMarkdown(null)).toEqual({ text: '', truncated: false });
  });

  it('aplica longitud y anidamiento juntos', () => {
    const r = prepareChatMarkdown('> '.repeat(40) + 'hola', { maxDepth: 2 });
    expect(r.truncated).toBe(false);
    expect((r.text.match(/>/g) ?? []).length).toBe(2);
  });

  it('conserva el Markdown normal sin alterarlo', () => {
    const md = '**Negrita**, _cursiva_ y una lista:\n\n- uno\n- dos\n';
    expect(prepareChatMarkdown(md).text).toBe(md);
  });
});
