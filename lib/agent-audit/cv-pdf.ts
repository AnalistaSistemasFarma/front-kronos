/**
 * HOJA DE VIDA EN PDF (Auditoría de agentes, F2) — HTML imprimible con la
 * marca GSS (gss-design: azul #1a3c6e, DM Sans / Source Sans 3, tarjetas
 * sobrias). Lo convierte a PDF el Chrome headless del SGC (lib/sgc/pdf/render),
 * que corre sin JavaScript y sin red: por eso el logo va incrustado (data URI)
 * y las fuentes caen a las del sistema si el servidor no tiene las de marca.
 *
 * TODO el texto pasa por esc(): nombres, propósito, hallazgos e historial
 * vienen de la base y no se confía en ellos.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { HojaDeVida } from './cv-db';

export function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

const fmtNum = new Intl.NumberFormat('es-CO');
export const num = (v: number) => fmtNum.format(Math.round(v));

/** Un 'YYYY-MM-DD' es un día de Colombia: se lee a mediodía para que no retroceda un día. */
function aFecha(v: string | Date): Date {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00.000Z`) : new Date(v);
}

/** Fecha larga en prosa formal: "2 de octubre de 2026". */
export function fechaLarga(iso: string | Date): string {
  return aFecha(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  return aFecha(iso).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Bogota',
  });
}

/** Logo oficial de GSS (blanco sobre azul) incrustado; null si no se encuentra. */
export async function logoGssDataUri(): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'portal-th', 'logo-gss.png'));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const SEVERIDAD: Record<string, { nombre: string; color: string }> = {
  critico: { nombre: 'Crítico', color: '#b3261e' },
  alto: { nombre: 'Alto', color: '#c2742c' },
  medio: { nombre: 'Medio', color: '#b07300' },
  bajo: { nombre: 'Bajo', color: '#6a7689' },
};
const TIPO: Record<string, string> = { 'claude-code': 'Claude Code', openclaw: 'OpenClaw' };
const SERVICIO: Record<string, string> = {
  activo: 'En ejecución',
  detenido: 'Detenido',
  'sin-servicio': 'Sin servicio',
  desconocido: 'Desconocido',
};
const POLITICA: Record<string, string> = {
  'lista-blanca': 'lista blanca',
  emparejamiento: 'emparejamiento',
  abierta: 'abierto a cualquiera',
  desconocida: 'política desconocida',
};
const TIPO_ENTRADA: Record<string, string> = {
  alta: 'Alta',
  inventario: 'Inventario',
  hallazgo_abierto: 'Hallazgo',
  hallazgo_cerrado: 'Hallazgo cerrado',
  perfil: 'Hoja de vida',
};

/** Barras de los últimos 30 días (SVG estático: el PDF no corre JavaScript). */
function graficaDias(dias: HojaDeVida['metricas']['dias']): string {
  const w = 680;
  const h = 120;
  const max = Math.max(1, ...dias.map((d) => d.recibidos + d.enviados));
  const paso = w / dias.length;
  const ancho = Math.max(2, paso - 4);
  const barras = dias
    .map((d, i) => {
      const hr = (d.recibidos / max) * (h - 20);
      const he = (d.enviados / max) * (h - 20);
      const x = i * paso + 2;
      return `<rect x="${x.toFixed(1)}" y="${(h - 14 - hr).toFixed(1)}" width="${ancho.toFixed(1)}" height="${hr.toFixed(1)}" fill="#1a3c6e"/>
<rect x="${x.toFixed(1)}" y="${(h - 14 - hr - he).toFixed(1)}" width="${ancho.toFixed(1)}" height="${he.toFixed(1)}" fill="#8fa3c0"/>`;
    })
    .join('');
  const etiqueta = (i: number, anchor: string) =>
    `<text x="${(i * paso + paso / 2).toFixed(1)}" y="${h - 2}" font-size="9" fill="#6a7689" text-anchor="${anchor}">${esc(dias[i].dia.slice(5).split('-').reverse().join('/'))}</text>`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<line x1="0" y1="${h - 14}" x2="${w}" y2="${h - 14}" stroke="#d8dde6"/>${barras}
${etiqueta(0, 'start')}${etiqueta(Math.floor(dias.length / 2), 'middle')}${etiqueta(dias.length - 1, 'end')}
</svg>`;
}

export function htmlHojaDeVida(
  f: HojaDeVida,
  opts: { generadoPor: string; generadoEl: Date; logo: string | null }
): string {
  const a = f.agente;
  const inv = f.inventario;
  const m30 = f.metricas.ultimos30;
  const mh = f.metricas.historico;
  const resumen = f.resumenes[0] ?? null;
  const asignados = f.usuarios.filter((u) => u.asignado);
  const noAsignados = f.usuarios.filter((u) => !u.asignado);

  const fila = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const kpi = (k: string, v: string, nota = '') =>
    `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-k">${esc(k)}</div>${nota ? `<div class="kpi-n">${esc(nota)}</div>` : ''}</div>`;
  const chip = (t: string, color = '#38445a') =>
    `<span class="chip" style="border-color:${color};color:${color}">${esc(t)}</span>`;

  const identificacion = [
    fila('Código', `<span class="mono">${esc(a.code)}</span>${a.handle ? ` · ${esc(a.handle)}` : ''}`),
    fila('Empresas', esc(a.empresas.map((e) => e.nombre).join(', ') || '—')),
    fila('Permiso para usarlo', esc(a.permiso ?? 'Sin subproceso asignado')),
    fila('En SynerLink desde', esc(fechaLarga(a.creadoEl))),
    fila('Estado', a.activo ? 'Activo' : 'Inactivo'),
    ...(inv
      ? [
          fila('Tipo', esc(TIPO[inv.kind] ?? inv.kind)),
          fila('Equipo', esc(`${inv.host}${inv.location ? ` · ${inv.location}` : ''}`)),
          fila('Modelo', esc(inv.model ?? '—')),
          fila('Servicio', esc(SERVICIO[inv.serviceStatus ?? 'desconocido'] ?? inv.serviceStatus)),
          fila('Último escaneo', esc(fechaLarga(inv.scannedAt))),
        ]
      : [fila('Inventario', 'Todavía no se ha escaneado.')]),
  ].join('');

  const perfil = f.perfil;
  const proposito = perfil?.purpose
    ? `<p>${esc(perfil.purpose)}</p>`
    : `<p class="muted">Sin propósito registrado.${a.description ? ` Descripción del catálogo: ${esc(a.description)}` : ''}</p>`;
  const dueno =
    perfil?.ownerName || perfil?.ownerEmail
      ? `${esc(perfil?.ownerName ?? '')}${perfil?.ownerEmail ? ` · ${esc(perfil.ownerEmail)}` : ''}`
      : '<span class="muted">Sin dueño registrado.</span>';

  const tablaUsuarios = (lista: typeof f.usuarios) =>
    `<table class="t"><thead><tr><th>Persona</th><th>Empresas</th><th class="r">Mensajes (30 días)</th><th class="r">Mensajes (total)</th><th>Último mensaje</th></tr></thead><tbody>${lista
      .map(
        (u) =>
          `<tr><td>${esc(u.nombre)}<div class="sub">${esc(u.email)}${u.activo ? '' : ' · usuario inactivo'}</div></td><td>${esc(u.empresas.join(', ') || '—')}</td><td class="r">${num(u.mensajes30)}</td><td class="r">${num(u.mensajes)}</td><td>${esc(fechaCorta(u.ultimoMensaje))}</td></tr>`
      )
      .join('')}</tbody></table>`;

  const mcps = inv?.mcps.length
    ? `<table class="t"><thead><tr><th>MCP</th><th>Empresa</th><th>Acceso</th><th>Autenticación</th></tr></thead><tbody>${inv.mcps
        .map(
          (x) =>
            `<tr><td class="mono">${esc(x.name)}</td><td>${esc(x.company ?? '—')}</td><td>${x.access === 'escritura' ? chip('escritura', '#c2742c') : x.access === 'lectura' ? chip('lectura', '#1f7a4d') : chip('sin determinar')}${x.writeTools ? `<div class="sub">${esc(x.writeTools)}</div>` : ''}</td><td>${x.auth === 'ninguna' ? chip('sin autenticación', '#b3261e') : x.auth === 'requerida' ? chip('con autenticación', '#1f7a4d') : x.auth === 'local' ? chip('local (stdio)') : chip('sin determinar')}</td></tr>`
        )
        .join('')}</tbody></table>`
    : '<p class="muted">Ningún MCP configurado.</p>';

  const reglas = inv
    ? `<ul>
<li><strong>Ejecución de comandos:</strong> ${inv.execRequiresApproval === false ? 'ejecuta comandos del sistema sin pedir aprobación' : inv.execRequiresApproval ? 'pide aprobación antes de ejecutar comandos' : 'sin determinar'}${inv.execMode ? ` (${esc(inv.execMode)})` : ''}.</li>
<li><strong>Herramientas:</strong> ${inv.tools.allow.length === 0 && inv.tools.deny.length === 0 ? 'sin lista declarada; usa las de su configuración por defecto' : `${num(inv.tools.allow.length)} permitidas y ${num(inv.tools.deny.length)} negadas`}.${inv.tools.allow.length ? `<div class="sub">Permitidas: ${esc(inv.tools.allow.join(', '))}</div>` : ''}${inv.tools.deny.length ? `<div class="sub">Negadas: ${esc(inv.tools.deny.join(', '))}</div>` : ''}</li>
<li><strong>Canales:</strong> ${inv.channels.length ? inv.channels.map((c) => `${esc(c.type)} con ${esc(POLITICA[c.policy] ?? c.policy)}${typeof c.allowed === 'number' ? ` (${num(c.allowed)} autorizados)` : ''}`).join('; ') : 'ninguno detectado'}.</li>
</ul>
<p class="muted">Las reglas de negocio, roles y personalidad administrados desde SynerLink llegan con la fase de gobierno; por ahora se muestra lo que el agente tiene configurado.</p>`
    : '<p class="muted">Sin inventario: no hay reglas que mostrar todavía.</p>';

  const hallazgos = (lista: typeof f.hallazgos.abiertos, cerrados: boolean) =>
    lista.length
      ? `<table class="t"><thead><tr><th>Severidad</th><th>Hallazgo</th><th>${cerrados ? 'Cerrado el' : 'Abierto desde'}</th></tr></thead><tbody>${lista
          .map((h) => {
            const s = SEVERIDAD[h.severity] ?? { nombre: h.severity, color: '#6a7689' };
            return `<tr><td>${chip(s.nombre, s.color)}</td><td>${esc(h.title)}${h.detail ? `<div class="sub">${esc(h.detail)}</div>` : ''}</td><td>${esc(fechaCorta(cerrados ? h.resolvedAt : h.firstSeenAt))}</td></tr>`;
          })
          .join('')}</tbody></table>`
      : `<p class="muted">${cerrados ? 'Ninguno cerrado todavía.' : 'Sin hallazgos abiertos.'}</p>`;

  const historial = f.historial.length
    ? `<table class="t"><thead><tr><th>Fecha</th><th>Tipo</th><th>Qué pasó</th></tr></thead><tbody>${f.historial
        .slice(0, 60)
        .map(
          (e) =>
            `<tr><td>${esc(fechaCorta(e.occurredAt))}</td><td>${esc(TIPO_ENTRADA[e.kind] ?? e.kind)}</td><td>${esc(e.title)}${e.detail ? `<div class="sub pre">${esc(e.detail)}</div>` : ''}${e.createdBy ? `<div class="sub">Por ${esc(e.createdBy)}</div>` : ''}</td></tr>`
        )
        .join('')}</tbody></table>${f.historial.length > 60 ? `<p class="muted">Se muestran las 60 entradas más recientes de ${num(f.historial.length)}.</p>` : ''}`
    : '<p class="muted">Sin entradas todavía.</p>';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>Hoja de vida · ${esc(a.displayName)}</title>
<style>
  @page { size: A4; margin: 1.6cm 1.5cm 1.8cm; }
  * { box-sizing: border-box; }
  body { font-family: 'Source Sans 3', 'Segoe UI', Calibri, Arial, sans-serif; font-size: 10pt; color: #0f1a2c; line-height: 1.45; margin: 0; }
  h1, h2, .brand { font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; }
  .head { background: #1a3c6e; color: #fff; border-radius: 10px; padding: 16px 20px; display: flex; align-items: center; gap: 16px; }
  .head img { height: 54px; }
  .head .k { font-size: 9pt; letter-spacing: .08em; text-transform: uppercase; opacity: .8; }
  .head h1 { margin: 2px 0 0; font-size: 20pt; font-weight: 700; }
  .head .s { font-size: 9.5pt; opacity: .9; }
  h2 { font-size: 12.5pt; color: #1a3c6e; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #d8dde6; break-after: avoid; }
  p { margin: 0 0 6px; }
  .muted { color: #6a7689; }
  .mono { font-family: Consolas, 'Courier New', monospace; font-size: 9pt; }
  .sub { color: #6a7689; font-size: 8.5pt; }
  .pre { white-space: pre-line; }
  table { border-collapse: collapse; width: 100%; }
  .kv th { text-align: left; width: 34%; color: #38445a; font-weight: 600; padding: 4px 8px 4px 0; vertical-align: top; }
  .kv td { padding: 4px 0; }
  .t { margin: 4px 0 8px; }
  .t th { background: #f5f7fa; color: #38445a; font-weight: 600; text-align: left; font-size: 8.5pt; padding: 5px 6px; border-bottom: 1px solid #d8dde6; }
  .t td { padding: 5px 6px; border-bottom: 1px solid #eef1f5; vertical-align: top; font-size: 9pt; }
  .t tr { break-inside: avoid; }
  .r { text-align: right; }
  .chip { display: inline-block; border: 1px solid; border-radius: 999px; padding: 0 7px; font-size: 8pt; margin: 1px 2px 1px 0; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
  .kpi { flex: 1 1 22%; border: 1px solid #d8dde6; border-radius: 10px; padding: 8px 10px; }
  .kpi-v { font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; font-size: 15pt; font-weight: 700; color: #1a3c6e; }
  .kpi-k { font-size: 8.5pt; color: #38445a; }
  .kpi-n { font-size: 7.5pt; color: #6a7689; }
  .card { border: 1px solid #d8dde6; border-radius: 10px; padding: 10px 12px; background: #f5f7fa; }
  .ley { font-size: 8pt; color: #6a7689; margin-top: 2px; }
  .ley span { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 4px -1px 10px; }
  ul { margin: 0 0 6px 16px; padding: 0; }
  li { margin-bottom: 3px; }
  .pie { margin-top: 22px; padding-top: 8px; border-top: 1px solid #d8dde6; font-size: 8pt; color: #6a7689; }
</style></head>
<body>
<div class="head">
  ${opts.logo ? `<img src="${opts.logo}" alt="GSS" />` : '<div class="brand" style="font-size:22pt;font-weight:700">GSS</div>'}
  <div>
    <div class="k">Hoja de vida del agente</div>
    <h1>${esc(a.displayName)}</h1>
    <div class="s">Auditoría de agentes · SynerLink · Generada el ${esc(fechaLarga(opts.generadoEl))}</div>
  </div>
</div>

<h2>Identificación</h2>
<table class="kv">${identificacion}</table>

<h2>Propósito y dueño</h2>
${proposito}
<p><strong>Dueño:</strong> ${dueno}</p>
${perfil?.updatedAt ? `<p class="sub">Actualizado el ${esc(fechaLarga(perfil.updatedAt))}${perfil.updatedBy ? ` por ${esc(perfil.updatedBy)}` : ''}.</p>` : ''}

<h2>Resumen de la semana</h2>
${
  resumen
    ? `<div class="card"><p class="pre">${esc(resumen.texto)}</p><p class="sub">Semana del ${esc(fechaLarga(resumen.semana))}. Redactado con inteligencia artificial solo a partir de cifras, inventario y hallazgos; no se leyó el texto de ninguna conversación.</p></div>`
    : '<p class="muted">Todavía no hay resumen semanal.</p>'
}

<h2>Métricas</h2>
<div class="kpis">
  ${kpi('Mensajes recibidos', num(m30.mensajesRecibidos), 'últimos 30 días')}
  ${kpi('Mensajes enviados', num(m30.mensajesEnviados), 'últimos 30 días')}
  ${kpi('Usuarios activos', num(m30.usuariosActivos), 'últimos 30 días')}
  ${kpi('Días activos', num(m30.diasActivos), 'de 30')}
  ${kpi('Consumo en tokens', num(m30.tokensTotal), `${num(m30.turnos)} turnos reportados`)}
  ${kpi('Mensajes históricos', num(mh.mensajesRecibidos + mh.mensajesEnviados), mh.primerDia ? `desde ${fechaCorta(mh.primerDia)}` : '')}
  ${kpi('Usuarios históricos', num(mh.usuariosActivos))}
  ${kpi('Días activos históricos', num(mh.diasActivos))}
</div>
${graficaDias(f.metricas.dias)}
<div class="ley"><span style="background:#1a3c6e"></span>Recibidos<span style="background:#8fa3c0"></span>Enviados · mensajes por día, últimos 30 días</div>
<p class="sub">El consumo lo declara cada agente y se cuenta una sola vez por turno, aunque el turno haya atendido varias conversaciones.${f.metricas.calculadoEl ? ` Métricas calculadas el ${esc(fechaLarga(f.metricas.calculadoEl))}.` : ''}</p>

<h2>Usuarios asignados (${num(asignados.length)})</h2>
${asignados.length ? tablaUsuarios(asignados) : '<p class="muted">Nadie tiene asignado este agente.</p>'}
${noAsignados.length ? `<p><strong>Le han escrito sin tenerlo asignado hoy (${num(noAsignados.length)}):</strong> por ejemplo en un grupo o antes de que se les retirara el permiso.</p>${tablaUsuarios(noAsignados)}` : ''}

<h2>Herramientas, MCP y skills</h2>
${mcps}
<p><strong>Skills (${num(inv?.skills.length ?? 0)}):</strong> ${inv?.skills.length ? esc(inv.skills.join(', ')) : '<span class="muted">ninguno instalado</span>'}</p>

<h2>Reglas vigentes</h2>
${reglas}

<h2>Hallazgos abiertos (${num(f.hallazgos.abiertos.length)})</h2>
${hallazgos(f.hallazgos.abiertos, false)}
<h2>Hallazgos cerrados recientes</h2>
${hallazgos(f.hallazgos.cerrados, true)}

<h2>Historial</h2>
${historial}

<div class="pie">Group Shared Services Latinoamérica · Documento confidencial generado por SynerLink para Gobierno de IA. Generado por ${esc(opts.generadoPor)} el ${esc(fechaLarga(opts.generadoEl))}. No contiene el texto de las conversaciones del agente.</div>
</body></html>`;
}
