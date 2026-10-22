import { CORREO_PAGE_SIZE } from './constants';
import { CorreoError } from './errors';
import { assertGraphId, codificarCursor, normalizarFiltros } from './graph';
import type { ArchivoAdjunto, Carpeta, Direccion, FiltrosBandeja, MailProvider, MensajeCompleto, NuevoCorreoEntrada, PaginaMensajes, RespuestaEntrada } from './types';

/**
 * Buzón SIMULADO (CORREO_MODO=mock): permite probar el módulo en pruebas y en la
 * CI mientras Infraestructura registra la app de Entra y otorga el consentimiento.
 * Datos ficticios; nada sale a Microsoft. El estado (respuestas, categorías) vive
 * en memoria por persona y se pierde al reiniciar.
 */

const PDF_MIN = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');

/** Carpetas del buzón simulado. */
const INBOX = 'mock-folder-inboxAAAA';
const ENVIADOS = 'mock-folder-sentAAAA';
const ELIMINADOS = 'mock-folder-deletedAAAA';
/**
 * Graph le cambia el id a un mensaje al moverlo; el simulado también (sufijo reversible), para que la
 * bandeja y «Deshacer» trabajen con el id nuevo igual que en producción.
 */
const SUFIJO_ELIMINADO = '-ELIM';

interface Estado {
  mensajes: MensajeCompleto[];
  /** Carpeta de cada mensaje (por id); sin entrada = Bandeja de entrada. */
  carpeta: Map<string, string>;
  enviados: Array<{ mensajeId: string; todos: boolean; texto: string; adjuntos: string[]; html?: string; comentarioHtml?: string }>;
  /** Correos NUEVOS (Redactar): quedan en «Elementos enviados» del buzón simulado. */
  nuevos: Array<{ asunto: string; html: string; para: string[]; cc: string[]; cco: string[]; adjuntos: string[] }>;
}

/** Directorio simulado (personas ficticias) para el autocompletado; el dominio es el del buzón de prueba. */
const DIRECTORIO_SIMULADO: Array<[string, string]> = [
  ['Usuario de Prueba Uno', 'prueba.uno'],
  ['Usuario de Prueba Dos', 'prueba.dos'],
  ['Persona de Calidad', 'calidad.pruebas'],
  ['Persona de Tesorería', 'tesoreria.pruebas'],
  ['Persona de Jurídica', 'juridica.pruebas'],
];

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
  return { mensajes, enviados: [], nuevos: [], carpeta: new Map() };
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

/** Solo para pruebas: los correos NUEVOS «enviados» desde el buzón simulado. */
export function nuevosSimulados(yo: string) {
  return estado(yo).nuevos;
}

export class MockMailProvider implements MailProvider {
  constructor(private readonly yo: string) {}

  async perfil() {
    return { correo: this.yo.toLowerCase() };
  }

  private carpetaDe(m: MensajeCompleto): string {
    return estado(this.yo).carpeta.get(m.id) ?? INBOX;
  }

  async carpetas(): Promise<Carpeta[]> {
    const ms = estado(this.yo).mensajes;
    const de = (id: string) => ms.filter((m) => this.carpetaDe(m) === id);
    const cuenta = (id: string) => ({ total: de(id).length, noLeidos: de(id).filter((m) => !m.leido).length });
    return [
      { id: INBOX, nombre: 'Bandeja de entrada', ...cuenta(INBOX) },
      { id: ENVIADOS, nombre: 'Elementos enviados', ...cuenta(ENVIADOS) },
      { id: ELIMINADOS, nombre: 'Elementos eliminados', ...cuenta(ELIMINADOS) },
    ];
  }

  async mensajes(filtros: FiltrosBandeja, cursor?: string | null): Promise<PaginaMensajes> {
    const f = normalizarFiltros(filtros);
    const carpeta = f.carpetaId ?? INBOX;
    const desde = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^\D+/, '')) || 0 : 0;
    const lista = estado(this.yo)
      .mensajes.filter((m) => {
        if (this.carpetaDe(m) !== carpeta) return false;
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

  async marcarLeido(mensajesIds: string[], leido: boolean): Promise<{ cambiados: number; fallidos: number }> {
    let cambiados = 0;
    let fallidos = 0;
    for (const id of new Set(mensajesIds)) {
      const m = estado(this.yo).mensajes.find((x) => x.id === id);
      if (m) {
        m.leido = leido;
        cambiados++;
      } else fallidos++;
    }
    return { cambiados, fallidos };
  }

  private deCarpeta(carpetaId: string | null) {
    const id = carpetaId ?? INBOX;
    return estado(this.yo).mensajes.filter((m) => this.carpetaDe(m) === id);
  }

  async ubicarMensajes(mensajesIds: string[]) {
    const out = new Map<string, { carpetaId: string; conversationId: string; internetMessageId: string; leido: boolean } | null>();
    for (const id of new Set(mensajesIds)) {
      const m = estado(this.yo).mensajes.find((x) => x.id === id);
      out.set(id, m ? { carpetaId: this.carpetaDe(m), conversationId: m.conversationId, internetMessageId: m.internetMessageId, leido: m.leido } : null);
    }
    return out;
  }

  async idCarpetaEliminados(): Promise<string> {
    return ELIMINADOS;
  }

  async moverMensajes(mensajesIds: string[], destinoId: string): Promise<Map<string, string | null>> {
    const e = estado(this.yo);
    const destino = destinoId === 'deleteditems' ? ELIMINADOS : destinoId;
    const out = new Map<string, string | null>();
    for (const id of new Set(mensajesIds)) {
      const m = e.mensajes.find((x) => x.id === id);
      if (!m || ![INBOX, ENVIADOS, ELIMINADOS].includes(destino)) {
        out.set(id, null);
        continue;
      }
      e.carpeta.delete(m.id);
      const base = m.id.endsWith(SUFIJO_ELIMINADO) ? m.id.slice(0, -SUFIJO_ELIMINADO.length) : m.id;
      m.id = destino === ELIMINADOS ? `${base}${SUFIJO_ELIMINADO}` : base;
      if (destino !== INBOX) e.carpeta.set(m.id, destino);
      out.set(id, m.id);
    }
    return out;
  }

  async idsPorLeido(carpetaId: string | null, leido: boolean, max: number): Promise<string[]> {
    return this.deCarpeta(carpetaId)
      .filter((m) => m.leido !== leido)
      .slice(0, max)
      .map((m) => m.id);
  }

  async contadoresCarpeta(carpetaId: string | null): Promise<{ total: number; noLeidos: number }> {
    const ms = this.deCarpeta(carpetaId);
    return { total: ms.length, noLeidos: ms.filter((m) => !m.leido).length };
  }

  async enviarNuevo(entrada: NuevoCorreoEntrada): Promise<void> {
    const e = estado(this.yo);
    e.nuevos.push({ asunto: entrada.asunto, html: entrada.html, para: entrada.para, cc: entrada.cc, cco: entrada.cco, adjuntos: entrada.adjuntos.map((a) => a.nombre) });
    const n = e.mensajes.length + 500;
    const yo = this.yo.toLowerCase();
    const m: MensajeCompleto = {
      id: `mock-msg-${n}AAAA`,
      conversationId: `mock-conv-nuevo${n}AAAA`,
      internetMessageId: `<mock-${n}.nuevo@correo.simulado>`,
      asunto: entrada.asunto,
      de: { nombre: yo, correo: yo },
      fecha: new Date().toISOString(),
      leido: true,
      conAdjuntos: entrada.adjuntos.length > 0,
      extracto: entrada.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
      categorias: [],
      para: entrada.para.map((c) => ({ nombre: c, correo: c })),
      cc: entrada.cc.map((c) => ({ nombre: c, correo: c })),
      html: entrada.html,
      adjuntos: [],
    };
    e.mensajes.push(m);
    e.carpeta.set(m.id, ENVIADOS);
  }

  async contactosRecientes(max: number): Promise<Direccion[]> {
    const e = estado(this.yo);
    const yo = this.yo.toLowerCase();
    const vistos = new Map<string, Direccion>();
    for (const n of [...e.nuevos].reverse()) for (const c of [...n.para, ...n.cc]) if (!vistos.has(c)) vistos.set(c, { nombre: c, correo: c });
    // Los remitentes de la bandeja simulada hacen de «personas a las que les respondió».
    for (const m of e.mensajes) if (m.de.correo !== yo && !vistos.has(m.de.correo)) vistos.set(m.de.correo, { ...m.de });
    return [...vistos.values()].slice(0, max);
  }

  async buscarDirectorio(q: string, dominios: string[], max: number): Promise<Direccion[]> {
    const t = q.toLowerCase();
    const dominio = dominios[0] ?? 'gsslatam.com';
    return DIRECTORIO_SIMULADO.map(([nombre, local]) => ({ nombre, correo: `${local}@${dominio}` }))
      .filter((x) => x.correo.startsWith(t) || x.nombre.toLowerCase().split(' ').some((p) => p.startsWith(t)))
      .slice(0, max);
  }

  async categorizar(mensajeId: string, categoria: string): Promise<void> {
    const m = estado(this.yo).mensajes.find((x) => x.id === mensajeId);
    if (m && !m.categorias.includes(categoria)) m.categorias.push(categoria);
  }
}
