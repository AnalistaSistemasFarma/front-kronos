/**
 * TURNO DE PROYECTO con un agente de OPENCLAW (HILOS_RUNNER=openclaw; 2026-10-27).
 * Es la versión openclaw de `atender` (puente.mjs): el camino de Claude Code no cambia.
 *
 * Reutiliza del puente de hilos: contexto del proyecto, Archivos, vinculados y cronograma,
 * adjuntos de entrada, propuestas del cronograma, validación de MEDIA: (adjuntos-salida.mjs),
 * archivado en la pestaña Archivos (archivar-proyecto.mjs), avisos de progreso y latido
 * (progreso.mjs), mensaje de corte, sesión por conversación (Estado) y consumo.
 *
 * NO suma capacidades al agente: sin conectores del proyecto ni del agente, sin PRUEBAS, sin
 * código, sin equipo de subagentes, sin plugins (config.mjs lo exige). El PDF del puente (HTML → PDF
 * con Chrome en sandbox) sí aplica desde 2026-10-27 (Nicolás Rivera: «sí, claro, con todos»).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prepararAdjuntos } from './adjuntos-salida.mjs';
import { analizarComando, AYUDA, LIMPIAR } from './comandos.mjs';
import {
  asegurarCarpetas,
  bajarAdjuntos,
  leerPropuestas,
  limpiarPropuestas,
  registrarConsumoLocal,
  rutasDelHilo,
  sincronizarArchivos,
  textoCronograma,
  textoVinculados,
} from './hilos.mjs';
import {
  abortarEnGateway,
  armarArgumentosOpenclaw,
  armarMensajeOpenclaw,
  claveCompleta,
  claveSesion,
  correrOpenclaw,
  entornoOpenclaw,
  esperarAnuncio,
  leerSalidaOpenclaw,
  MARGEN_TIMEOUT_OPENCLAW_S,
  recogerOutbox,
  textoEncabezadoOpenclaw,
  textoPdfOpenclaw,
} from './openclaw.mjs';
import { convertirHtmlAPdf, convertirMarcasPdf, resolverChrome } from './pdf.mjs';
import { archivosDelTurno, archivosModificadosDesde, crearSupervisor, duracionLegible, textoAvisoProgreso, textoCorte } from './progreso.mjs';

const MAX_RESPUESTA = 40_000;

export const TEXTO_AYUDA_OPENCLAW = [
  '**Comandos en esta conversación de proyecto**',
  '',
  '- `/ayuda`: esta lista.',
  '- `/clear` (o `/nueva`): el asistente arranca una **memoria nueva** en esta conversación desde el próximo mensaje. El historial del chat sigue a la vista.',
  '',
  'Los demás comandos (`/goal`, `/compact`, skills…) no están disponibles con este asistente en Proyectos: escríbale lo que necesita en palabras.',
].join('\n');

/** ¿Es un lote de UN mensaje que es solo un comando? Devuelve { accion, texto? } o null. */
export function comandoOpenclaw(lote) {
  if (lote.length !== 1) return null;
  const c = analizarComando(lote[0]?.body);
  if (!c) return null;
  const nombre = String(c.nombre ?? '').toLowerCase();
  if (c.plugin) return { accion: 'responder', texto: `\`/${c.completo}\` no está disponible con este asistente en los proyectos. Escríbale lo que necesita en palabras; \`/ayuda\` muestra lo que sí funciona.` };
  if (AYUDA.has(nombre)) return { accion: 'responder', texto: TEXTO_AYUDA_OPENCLAW };
  if (LIMPIAR.has(nombre)) return { accion: 'limpiar' };
  return { accion: 'responder', texto: `\`/${nombre}\` no está disponible con este asistente en los proyectos. Escríbale lo que necesita en palabras; \`/ayuda\` muestra lo que sí funciona.` };
}

/**
 * Crea el `atender` y el `sugerirEquipo` del runner openclaw.
 * Dependencias inyectables para las pruebas: correr, abortar, observar, leerSesionGateway, anuncios.
 */
export function crearAtenderOpenclaw({
  cfg,
  synerlink,
  estado,
  archivador = null,
  log = () => {},
  correr = correrOpenclaw,
  abortar = abortarEnGateway,
  observar = null,
  leerSesionGateway = null,
  anunciosPendientes = null,
  convertirPdf = convertirHtmlAPdf,
  chrome = undefined,
  ahora = Date.now,
}) {
  const oc = cfg.openclaw;
  // HTML → PDF en el puente (pdf.mjs), igual que con Claude Code: Chrome en sandbox, sin red.
  const chromePdf = cfg.pdf?.habilitado ? (chrome !== undefined ? chrome : resolverChrome({ explicito: cfg.pdf?.chrome ?? null, home: process.env.HOME })) : null;
  const recursos = oc.recursos ?? [];

  async function atender(claveConv, lote) {
    const idConversation = Number(claveConv);
    const ids = lote.map((m) => m.id);
    const inicio = ahora();
    let supervisor = null;
    let observador = null;
    let archivoMensaje = null;
    try {
      await synerlink.estado(idConversation, 'thinking', 'Preparando el proyecto…').catch(() => null);
      const contexto = await synerlink.contexto(idConversation);
      if (!cfg.perfiles.get(contexto.project.profile.key)) {
        await synerlink.responder(
          idConversation,
          `No puedo atender este proyecto: su perfil de conectores («${contexto.project.profile.label}») no está configurado en el puente de este asistente (solo trabaja con «Sin conectores» y sus propias herramientas). Avísele a Tecnología.`
        );
        return;
      }

      const comando = comandoOpenclaw(lote);
      if (comando?.accion === 'responder') {
        await synerlink.responder(idConversation, comando.texto);
        return;
      }
      if (comando?.accion === 'limpiar') {
        estado.reiniciarSesion(idConversation);
        await synerlink.responder(
          idConversation,
          '🧹 Listo: esta conversación arranca una **memoria nueva** desde el próximo mensaje. El historial del chat sigue aquí, pero el asistente ya no lo tiene presente; si hace falta algo de antes, péguelo o resúmalo.'
        );
        return;
      }

      const rutas = rutasDelHilo(cfg.areaDir ?? cfg.hilosDir, contexto.project.idProject, idConversation);
      asegurarCarpetas(rutas);
      await sincronizarArchivos({ rutas, contexto, estado, descargar: (u) => synerlink.descargar(u) });
      const adjuntosRel = await bajarAdjuntos({ rutas, mensajes: lote, descargar: (u) => synerlink.descargar(u) });
      const adjuntos = adjuntosRel.map((r) => path.join(rutas.cwd, r));
      writeFileSync(rutas.vinculados, textoVinculados(contexto), { mode: 0o600 });
      writeFileSync(rutas.cronograma, textoCronograma(contexto), { mode: 0o600 });
      limpiarPropuestas(rutas);

      const sesion = estado.sesionDe(idConversation);
      const clave = claveSesion({ prefijo: oc.prefijo, idConversation, sessionId: sesion.id });
      const completa = claveCompleta(oc.agente, clave);
      const encabezado = textoEncabezadoOpenclaw({
        agente: cfg.agenteNombre ?? cfg.agente,
        enfoque: cfg.enfoque,
        contexto,
        rutas,
        idConversation,
        topeMs: cfg.timeoutTurnoMs,
        avisoMs: cfg.avisoProgresoMs ?? 0,
        archivar: Boolean(archivador),
        outbox: oc.outbox,
        bloquePdf: cfg.pdf?.habilitado ? textoPdfOpenclaw({ disponible: Boolean(chromePdf), recursos, trabajo: rutas.trabajo }) : '',
      });
      mkdirSync(rutas.puente, { recursive: true, mode: 0o700 });
      archivoMensaje = path.join(rutas.puente, `mensaje-${process.pid}-${idConversation}.txt`);
      writeFileSync(archivoMensaje, armarMensajeOpenclaw({ encabezado, lote, adjuntos }), { mode: 0o600 });

      // Indicador: lo que esté mostrando ahora (los avisos y el latido lo conservan).
      let indicador = { state: 'thinking', label: '🧠 Pensando su respuesta…' };
      const publicar = (conv, state, label, tasks) => {
        if (label) indicador = { state, label };
        return synerlink.estado(conv, state, label, tasks);
      };
      await publicar(idConversation, 'thinking', indicador.label).catch(() => null);
      supervisor = crearSupervisor({
        intervaloAvisoMs: cfg.avisoProgresoMs ?? 0,
        alAviso: async (ms) => {
          await synerlink.avisar(idConversation, textoAvisoProgreso({ transcurridoMs: ms, topeMs: cfg.timeoutTurnoMs, actividad: indicador.label }), indicador.state, indicador.label);
          log(`conversación ${idConversation}: aviso de progreso (${duracionLegible(ms)}).`);
        },
        alLatido: () => synerlink.estado(idConversation, indicador.state, indicador.label),
      });
      // Indicador fino por el Gateway (no aplica con --local ni con perfil propio sin Gateway).
      if (observar && oc.actividad && !oc.local) {
        try {
          observador = await observar({ agentId: oc.agente, sessionKey: completa, conversationId: idConversation, publicar, log, openclawBin: oc.bin });
          if (!observador?.conectado) log(`conversación ${idConversation}: indicador fino sin Gateway; queda el básico.`);
        } catch (e) {
          observador = null;
          log(`conversación ${idConversation}: no se pudo abrir el indicador fino: ${e.message}`);
        }
      }

      const args = armarArgumentosOpenclaw({
        perfil: oc.perfil,
        agente: oc.agente,
        clave,
        archivoMensaje,
        timeoutS: Math.ceil(cfg.timeoutTurnoMs / 1000) + MARGEN_TIMEOUT_OPENCLAW_S,
        local: oc.local,
      });
      try {
        writeFileSync(path.join(rutas.puente, 'ultimo-comando.json'), JSON.stringify({ ts: new Date().toISOString(), bin: oc.bin, args }, null, 2), { mode: 0o600 });
      } catch {}
      log(`conversación ${idConversation}: turno openclaw (${completa}${sesion.nueva ? ', sesión nueva' : ''}).`);
      observador?.armar?.();
      let r;
      try {
        r = await correr({
          bin: oc.bin,
          args,
          env: entornoOpenclaw(process.env, oc.bin),
          cwd: rutas.cwd,
          timeoutMs: cfg.timeoutTurnoMs,
          alAbortar: oc.local ? async () => {} : () => abortar({ bin: oc.bin, perfil: oc.perfil, clave: completa }),
        });
      } finally {
        await observador?.cerrar?.().catch?.(() => null);
      }
      let s = leerSalidaOpenclaw(r.salida);
      let abortado = r.abortado;

      // Cedió el turno a un sub-agente: se espera su resultado DENTRO de este turno.
      if (!abortado && s.ok && (s.cedio || (!s.texto && s.lanzo)) && leerSesionGateway && anunciosPendientes && !oc.local) {
        indicador = { state: 'thinking', label: '⏳ Trabajando en segundo plano…' };
        await synerlink.estado(idConversation, indicador.state, indicador.label).catch(() => null);
        log(`conversación ${idConversation}: el agente cedió el turno; espero el resultado.`);
        const texto = await esperarAnuncio({ clave: completa, desdeMs: inicio, hastaMs: inicio + cfg.timeoutTurnoMs, leer: leerSesionGateway, anunciosPendientes, ahora });
        if (texto) s = { ...s, texto };
        else {
          abortado = 'tiempo agotado';
          await abortar({ bin: oc.bin, perfil: oc.perfil, clave: completa }).catch(() => null);
        }
      }
      // La sesión existe en openclaw desde que el turno arrancó: «continúa» retoma la misma.
      if (r.salida || abortado) estado.marcarIniciada(idConversation, sesion.id);
      await supervisor.detener();
      const transcurridoMs = ahora() - inicio;
      const archivos = () => archivosDelTurno({ cwd: rutas.cwd, escaneados: archivosModificadosDesde(rutas.trabajo, inicio, { base: rutas.cwd, excluir: [path.basename(rutas.propuestas)] }) });

      let cuerpo;
      let adjuntosSalida = [];
      if (abortado) {
        cuerpo = textoCorte({ motivo: 'tiempo', transcurridoMs, topeMs: cfg.timeoutTurnoMs, ultimoTexto: s.texto || null, archivos: archivos() });
        log(`conversación ${idConversation}: turno cortado por tiempo tras ${duracionLegible(transcurridoMs)}.`);
      } else if (!s.ok || !r.salida) {
        const lista = archivos();
        cuerpo = s.texto || lista.length ? textoCorte({ motivo: 'error', transcurridoMs, ultimoTexto: s.texto || null, archivos: lista }) : 'No pude completar la respuesta por un error del asistente. Intente de nuevo en unos minutos.';
        log(`conversación ${idConversation}: turno con error (código ${r.codigo}; ${s.error ?? 'sin salida JSON'}; ${String(r.stderr ?? '').slice(-300).replace(/\s+/g, ' ')}).`);
      } else {
        cuerpo = s.texto || '_(El asistente terminó sin texto.)_';
        if (cfg.pdf?.habilitado) {
          try {
            const conv = await convertirMarcasPdf(cuerpo, {
              cwd: rutas.cwd,
              trabajo: rutas.trabajo,
              lecturas: [rutas.trabajo, rutas.adjuntos, rutas.contexto, rutas.archivos, ...recursos],
              chrome: chromePdf,
              timeoutMs: cfg.pdf?.timeoutMs,
              convertir: async (o) => {
                await synerlink.estado(idConversation, 'tool', 'Generando el PDF…').catch(() => null);
                return convertirPdf(o);
              },
              log: (m) => log(`conversación ${idConversation}: ${m}`),
            });
            cuerpo = conv.texto;
          } catch (e) {
            log(`conversación ${idConversation}: error al convertir a PDF:`, e.message);
          }
        }
        // Lo que dejó en el outbox de su chat pasa a ./trabajo; luego la validación de siempre.
        cuerpo = recogerOutbox(cuerpo, { outbox: oc.outbox, trabajo: rutas.trabajo, log: (m) => log(`conversación ${idConversation}: ${m}`) });
        const prep = await prepararAdjuntos(cuerpo, { cwd: rutas.cwd, trabajo: rutas.trabajo, excluir: [path.basename(rutas.propuestas)], log: (m) => log(`conversación ${idConversation}: ${m}`) });
        cuerpo = prep.texto;
        adjuntosSalida = prep.archivos;
      }

      // Propuestas del cronograma: con la llave del PUENTE, pendientes de confirmación.
      let notas = '';
      const prop = leerPropuestas(rutas);
      if (prop.error) log(`conversación ${idConversation}: ${prop.error}`);
      if (s.ok && !abortado && prop.items.length > 0) {
        try {
          const res = await synerlink.proponer(idConversation, prop.items);
          const n = res?.creadas?.length ?? 0;
          const m = res?.rechazadas?.length ?? 0;
          if (n > 0) notas += `\n\n📌 Dejé ${n === 1 ? '1 propuesta' : `${n} propuestas`} en el **Cronograma** del proyecto. Nada cambia hasta que un dueño o editor la${n === 1 ? '' : 's'} confirme.`;
          if (m > 0) notas += `\n\n⚠️ ${m === 1 ? '1 propuesta no se pudo registrar' : `${m} propuestas no se pudieron registrar`}: ${res.rechazadas.map((x) => x.error).slice(0, 3).join(' · ')}`;
        } catch (e) {
          log(`conversación ${idConversation}: no se pudieron entregar las propuestas:`, e.message);
          notas = '\n\n⚠️ No pude registrar mis propuestas en el Cronograma por un error. Intente de nuevo.';
        }
      }
      cuerpo = cuerpo.slice(0, MAX_RESPUESTA - notas.length) + notas;

      if (archivador && adjuntosSalida.length > 0) {
        await synerlink.estado(idConversation, 'tool', 'Archivando en el proyecto…').catch(() => null);
        const nota = await archivador.archivar(idConversation, adjuntosSalida);
        if (nota) cuerpo = `${cuerpo.slice(0, Math.max(0, MAX_RESPUESTA - nota.length - 2))}\n\n${nota}`;
      }
      if (adjuntosSalida.length > 0) {
        try {
          await synerlink.responderConArchivos(idConversation, cuerpo, adjuntosSalida);
          log(`conversación ${idConversation}: respuesta con ${adjuntosSalida.length} adjunto(s): ${adjuntosSalida.map((a) => `${a.nombre} (${a.bytes} B)`).join(', ')}.`);
        } catch (e) {
          log(`conversación ${idConversation}: no se pudieron subir los adjuntos, se publica sin ellos:`, e.message);
          await synerlink.responder(idConversation, `${cuerpo}\n\n⚠️ No pude subir ${adjuntosSalida.length === 1 ? 'el archivo' : 'los archivos'} (${adjuntosSalida.map((a) => a.nombre).join(', ')}) por un error al guardarlos. Intente de nuevo en unos minutos.`);
        }
      } else {
        await synerlink.responder(idConversation, cuerpo);
      }

      if (s.tokens) {
        const reporte = {
          idConversation,
          sessionId: sesion.id,
          models: s.modelos,
          apiMessages: 1,
          apiMessagesSubagents: 0,
          tokens: s.tokens,
          turnStartedAt: new Date(inicio).toISOString(),
          turnEndedAt: new Date(ahora()).toISOString(),
        };
        registrarConsumoLocal(cfg.hilosDir, { ...reporte, runner: 'openclaw', sessionKey: completa, idProject: contexto.project.idProject, costoUsd: s.costoUsd, mensajes: ids.length });
        const total = s.tokens.input + s.tokens.cacheCreation + s.tokens.cacheRead + s.tokens.output;
        if (total > 0) await synerlink.consumo(reporte).catch((e) => log('no se pudo reportar el consumo:', e.message));
      }
    } catch (err) {
      log(`conversación ${idConversation}: error atendiendo el turno:`, err?.message ?? err);
      await synerlink.responder(idConversation, 'No pude atender el mensaje por un error del puente. Tecnología ya quedó con el registro.').catch(() => null);
    } finally {
      await supervisor?.detener().catch(() => null);
      if (archivoMensaje) rmSync(archivoMensaje, { force: true });
      // ack al final (con ack=false en la bandeja): si el puente se cae a mitad, el mensaje vuelve.
      await synerlink.confirmar(ids).catch((e) => log('no se pudo confirmar:', e.message));
      await synerlink.estado(idConversation, 'idle', null, []).catch(() => null);
    }
  }

  /** «Sugerir equipo» usa `claude -p`: con openclaw no aplica, y se dice para no dejar la pantalla esperando. */
  async function sugerirEquipo(pedido) {
    await synerlink
      .entregarSugerencia(pedido?.idRequest, { error: 'Este asistente trabaja con su propio motor (openclaw) y no arma equipos de subagentes sugeridos. Use el proyecto sin equipo.' })
      .catch((e) => log(`pedido de equipo ${pedido?.idRequest}: no se pudo responder:`, e.message));
  }

  return { atender, sugerirEquipo };
}
