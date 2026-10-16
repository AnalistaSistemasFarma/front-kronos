import { CORREO_PAGE_SIZE } from './constants';
import { CorreoError } from './errors';
import { assertGraphId, codificarCursor, normalizarFiltros } from './graph';
import type { ArchivoAdjunto, Carpeta, FiltrosBandeja, MailProvider, MensajeCompleto, PaginaMensajes, RespuestaEntrada } from './types';

/**
 * Buzón SIMULADO (CORREO_MODO=mock): permite probar el módulo en pruebas y en la
 * CI mientras Infraestructura registra la app de Entra y otorga el consentimiento.
 * Datos ficticios; nada sale a Microsoft. El estado (respuestas, categorías) vive
 * en memoria por persona y se pierde al reiniciar.
 */

const PDF_MIN = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');

interface Estado {
  mensajes: MensajeCompleto[];
  enviados: Array<{ mensajeId: string; todos: boolean; texto: string; adjuntos: string[]; html?: string; comentarioHtml?: string }>;
}

const estados: Map<string, Estado> =
  ((globalThis as Record<string, unknown>).__correoMock as never) ?? ((globalThis as Record<string, unknown>).__correoMock = new Map());

function fecha(diasAtras: number, hora: number): string {
  const d = new Date(Date.UTC(2026, 9, 15, hora, 0, 0));
  d.setUTCDate(d.getUTCDate() - diasAtras);
  return d.toISOString();
}

function msg(
  n: number,
  p: { conv: string; asunto: string; de: [string, string]; dias: number; hora: number; html: string; leido?: boolean; adjuntos?: boolean },
  yo: string
): MensajeCompleto {
  const id = `mock-msg-${String(n).padStart(4, '0')}AAAA`;
  return {
    id,
    conversationId: `mock-conv-${p.conv}AAAA`,
    internetMessageId: `<mock-${n}.${p.conv}@correo.simulado>`,
    asunto: p.asunto,
    de: { nombre: p.de[0], correo: p.de[1] },
    fecha: fecha(p.dias, p.hora),
    leido: Boolean(p.leido),
    conAdjuntos: Boolean(p.adjuntos),
    extracto: p.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    categorias: [],
    para: [{ nombre: yo, correo: yo }],
    cc: [],
    html: p.html,
    adjuntos: p.adjuntos ? [{ id: `mock-adj-${n}AAAA`, nombre: `soporte-${n}.pdf`, tipo: 'application/pdf', tamano: PDF_MIN.length, enLinea: false }] : [],
  };
}

function semilla(yo: string): Estado {
  const mensajes = [
    msg(1, { conv: '01', asunto: 'Revisión de contrato de arrendamiento bodega', de: ['Usuario de Prueba Uno', 'prueba.uno@gsslatam.com'], dias: 1, hora: 14, adjuntos: true, html: '<p>Buen día,</p><p>Adjunto el contrato de arrendamiento de la bodega para su revisión. Es un <b>contrato nuevo</b> de menor cuantía.</p><p>Gracias.</p>' }, yo),
    msg(2, { conv: '01', asunto: 'RE: Revisión de contrato de arrendamiento bodega', de: ['Usuario de Prueba Uno', 'prueba.uno@gsslatam.com'], dias: 0, hora: 13, html: '<p>Les comparto también la cámara de comercio actualizada.</p><img src="https://rastreo.ejemplo.com/pixel.gif">' }, yo),
    msg(3, { conv: '02', asunto: 'Solicitud de poder para trámite ante INVIMA', de: ['Usuario de Prueba Dos', 'prueba.dos@onelatampharma.com'], dias: 2, hora: 15, leido: true, html: '<p>Requerimos un poder especial para radicar el trámite. <a href="https://www.invima.gov.co">Ver portal</a></p><script>alert(1)</script>' }, yo),
    msg(4, { conv: '03', asunto: 'Consulta sobre marca registrada', de: ['Asesor Externo', 'asesor@externo-ejemplo.com'], dias: 3, hora: 16, adjuntos: true, html: '<p>Remito el estado de la solicitud de registro de marca.</p>' }, yo),
    msg(5, { conv: '04', asunto: 'Otrosí contrato de mantenimiento', de: ['Usuario de Prueba Uno', 'prueba.uno@gsslatam.com'], dias: 5, hora: 12, leido: true, html: '<p>Necesitamos un otrosí para ampliar el plazo del contrato de mantenimiento.</p>' }, yo),
  ];
  return { mensajes, enviados: [] };
}

function estado(yo: string): Estado {
  const k = yo.toLowerCase();
  let e = estados.get(k);
  if (!e) {
    e = semilla(k);
    estados.set(k, e);
  }
  return e;
}

/** Solo para pruebas: reinicia el buzón simulado. */
export function reiniciarBuzonSimulado(): void {
  estados.clear();
}

/** Solo para pruebas: lo que se «envió» desde el buzón simulado. */
export function enviadosSimulados(yo: string) {
  return estado(yo).enviados;
}

export class MockMailProvider implements MailProvider {
  constructor(private readonly yo: string) {}

  async perfil() {
    return { correo: this.yo.toLowerCase() };
  }

  async carpetas(): Promise<Carpeta[]> {
    const ms = estado(this.yo).mensajes;
    return [
      { id: 'mock-folder-inboxAAAA', nombre: 'Bandeja de entrada', total: ms.length, noLeidos: ms.filter((m) => !m.leido).length },
      { id: 'mock-folder-sentAAAA', nombre: 'Elementos enviados', total: 0, noLeidos: 0 },
    ];
  }

  async mensajes(filtros: FiltrosBandeja, cursor?: string | null): Promise<PaginaMensajes> {
    const f = normalizarFiltros(filtros);
    if (f.carpetaId === 'mock-folder-sentAAAA') return { mensajes: [], siguiente: null };
    const desde = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^\D+/, '')) || 0 : 0;
    const lista = estado(this.yo)
      .mensajes.filter((m) => {
        const dia = m.fecha.slice(0, 10);
        if (f.desde && dia < f.desde) return false;
        if (f.hasta && dia > f.hasta) return false;
        if (f.de && m.de.correo !== f.de) return false;
        if (f.noLeidos && m.leido) return false;
        if (f.conAdjuntos && !m.conAdjuntos) return false;
        if (f.buscar && !`${m.asunto} ${m.extracto} ${m.de.nombre}`.toLowerCase().includes(f.buscar.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    const pagina = lista.slice(desde, desde + CORREO_PAGE_SIZE);
    const resto = desde + CORREO_PAGE_SIZE < lista.length;
    return {
      mensajes: pagina.map(({ html: _h, para: _p, cc: _c, adjuntos: _a, ...r }) => r),
      siguiente: resto ? codificarCursor(`mock:${desde + CORREO_PAGE_SIZE}`) : null,
    };
  }

  async hilo(conversationId: string): Promise<MensajeCompleto[]> {
    const id = assertGraphId(conversationId, 'identificador del hilo');
    return estado(this.yo)
      .mensajes.filter((m) => m.conversationId === id)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map((m) => ({ ...m }));
  }

  async mensaje(id: string): Promise<MensajeCompleto> {
    const mid = assertGraphId(id);
    const m = estado(this.yo).mensajes.find((x) => x.id === mid);
    if (!m) throw new CorreoError('No se encontró el correo (pudo moverse o borrarse).', 404);
    return { ...m };
  }

  async adjunto(mensajeId: string, adjuntoId: string): Promise<ArchivoAdjunto> {
    const m = await this.mensaje(mensajeId);
    const aid = assertGraphId(adjuntoId, 'identificador del adjunto');
    const a = m.adjuntos.find((x) => x.id === aid);
    if (!a) throw new CorreoError('No se encontró el correo (pudo moverse o borrarse).', 404);
    return { nombre: a.nombre, tipo: a.tipo, bytes: PDF_MIN };
  }

  async responder(mensajeId: string, entrada: RespuestaEntrada): Promise<void> {
    const m = await this.mensaje(mensajeId);
    const e = estado(this.yo);
    e.enviados.push({ mensajeId, todos: entrada.todos, texto: entrada.texto, adjuntos: entrada.adjuntos.map((a) => a.nombre), ...(entrada.html ? { html: entrada.html } : {}), ...(entrada.comentarioHtml ? { comentarioHtml: entrada.comentarioHtml } : {}) });
    const n = e.mensajes.length + 100;
    e.mensajes.push({
      ...m,
      id: `mock-msg-${n}AAAA`,
      internetMessageId: `<mock-${n}.respuesta@correo.simulado>`,
      asunto: m.asunto.startsWith('RE:') ? m.asunto : `RE: ${m.asunto}`,
      de: { nombre: this.yo, correo: this.yo },
      para: [m.de],
      fecha: new Date().toISOString(),
      leido: true,
      conAdjuntos: entrada.adjuntos.length > 0,
      html: entrada.comentarioHtml ?? `<p>${entrada.texto.replace(/</g, '&lt;')}</p>`,
      extracto: entrada.texto.slice(0, 200),
      adjuntos: [],
      categorias: [],
    });
  }

  async categorizar(mensajeId: string, categoria: string): Promise<void> {
    const m = estado(this.yo).mensajes.find((x) => x.id === mensajeId);
    if (m && !m.categorias.includes(categoria)) m.categorias.push(categoria);
  }
}
