#!/usr/bin/env node
/**
 * PUENTE DE HILOS — SynerLink (proyectos) ⇄ Claude Code, una sesión por hilo.
 * F1 piloto (Play, solo PRUEBAS), aprobado por Nicolás Rivera el 2026-10-17.
 *
 * Es un SERVICIO APARTE del bot vivo: no toca su launchd, su .env, su config
 * ni su sesión. Se prende y se apaga solo (launchd/…plist.example).
 *
 *   1. Long-poll de la bandeja de PROYECTOS con la llave de scope "projects".
 *   2. Cada mensaje entra a la cola de SU conversación (serie por hilo, tope
 *      de 2 hilos simultáneos).
 *   3. Por turno: pide el contexto del proyecto, sincroniza archivos, escribe
 *      CLAUDE.md / sistema.md / mcp.json y corre `claude -p --resume <id>`
 *      en la carpeta del hilo, con config dir aislado y herramientas mínimas.
 *   4. Publica la respuesta en el hilo, deja el indicador en reposo, reporta
 *      el consumo y confirma (ack) los mensajes atendidos.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cargarConfig, ErrorConfig } from './config.mjs';
import { ColaHilos } from './cola.mjs';
import { crearClienteSynerLink } from './synerlink.mjs';
import { armarArgumentos, armarEntorno, correrTurno, etiquetaHerramienta } from './claude.mjs';
import {
  armarPrompt,
  asegurarCarpetas,
  bajarAdjuntos,
  escribirContexto,
  Estado,
  registrarConsumoLocal,
  rutasDelHilo,
  sincronizarArchivos,
} from './hilos.mjs';

const MAX_RESPUESTA = 40_000;

function log(...partes) {
  console.log(new Date().toISOString(), '[puente-hilos]', ...partes);
}

/** El `claude` instalado debe soportar lo que el puente exige; si no, no arranca. */
export function verificarClaude(bin, ayuda) {
  const texto = ayuda ?? execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 30_000 });
  const faltan = ['--restricted', '--strict-mcp-config', 'dontAsk', '--append-system-prompt', '--session-id', '--tools'].filter(
    (b) => !texto.includes(b)
  );
  if (faltan.length > 0) throw new ErrorConfig(`El claude instalado no soporta: ${faltan.join(', ')}. Actualícelo.`);
}

/**
 * La llave DEBE ser de scope "projects". Si la bandeja no responde así, es la
 * llave del bot vivo y el puente le robaría sus mensajes: no arranca.
 */
export function verificarBandeja(respuesta, agenteEsperado) {
  if (respuesta?.scope !== 'projects') {
    throw new ErrorConfig('La llave no es de scope "projects" (¿es la del bot vivo?). El puente no arranca.');
  }
  if ((respuesta?.agent?.code ?? '').toLowerCase() !== agenteEsperado) {
    throw new ErrorConfig(`La llave es del agente "${respuesta?.agent?.code}", no de "${agenteEsperado}".`);
  }
}

export function crearPuente({ cfg, synerlink, estado, correr = correrTurno }) {
  const enProceso = new Set();

  async function atender(claveConv, lote) {
    const idConversation = Number(claveConv);
    const ids = lote.map((m) => m.id);
    const inicio = new Date();
    try {
      await synerlink.estado(idConversation, 'thinking', 'Preparando el proyecto…').catch(() => null);

      const contexto = await synerlink.contexto(idConversation);
      const perfil = cfg.perfiles.get(contexto.project.profile.key);
      if (!perfil) {
        // Perfil que este puente no conoce: no se improvisa ningún conector.
        await synerlink.responder(
          idConversation,
          `No puedo atender este proyecto: su perfil de conectores («${contexto.project.profile.label}») no está configurado en el puente. Avísele a Tecnología.`
        );
        return;
      }

      const rutas = rutasDelHilo(cfg.hilosDir, contexto.project.idProject, idConversation);
      asegurarCarpetas(rutas);
      await sincronizarArchivos({ rutas, contexto, estado, descargar: (u) => synerlink.descargar(u) });
      const adjuntos = await bajarAdjuntos({ rutas, mensajes: lote, descargar: (u) => synerlink.descargar(u) });
      escribirContexto({ rutas, agente: cfg.agenteNombre ?? cfg.agente, contexto, perfil, instruccionesEn: cfg.instruccionesEn });

      const ejecutar = async (sesion) => {
        const args = armarArgumentos({
          perfil,
          sesion,
          rutaMcp: rutas.mcp,
          rutaSistema: rutas.sistema,
          dirArchivos: rutas.archivos,
          modelo: cfg.modelo,
          presupuestoUsd: cfg.presupuestoUsd,
        });
        let ultimaEtiqueta = null;
        return correr({
          bin: cfg.claudeBin,
          args,
          env: armarEntorno(cfg),
          cwd: rutas.cwd,
          prompt: armarPrompt(lote, adjuntos),
          perfil,
          timeoutMs: cfg.timeoutTurnoMs,
          alEvento: (evento, acc) => {
            if (evento.type !== 'assistant' || !acc.ultimaHerramienta) return;
            const etiqueta = etiquetaHerramienta(acc.ultimaHerramienta);
            if (etiqueta === ultimaEtiqueta) return;
            ultimaEtiqueta = etiqueta;
            void synerlink.estado(idConversation, 'tool', etiqueta).catch(() => null);
          },
        });
      };

      await synerlink.estado(idConversation, 'thinking', 'Pensando…').catch(() => null);
      let sesion = estado.sesionDe(idConversation);
      let r = await ejecutar(sesion);

      // La sesión guardada ya no existe en el config aislado: se abre una nueva
      // UNA vez, y se dice en el hilo (perdió la memoria de esa conversación).
      let aviso = '';
      // Lo mismo si un intento anterior dejó el id «ocupado» (stub de sesión).
      const sesionPerdida = !sesion.nueva && /No conversation found|no such session/i.test(r.stderr ?? '');
      const idOcupado = sesion.nueva && /already in use|already exists/i.test(r.stderr ?? '');
      if (!r.resultado && !r.abortado && (sesionPerdida || idOcupado)) {
        estado.reiniciarSesion(idConversation);
        sesion = estado.sesionDe(idConversation);
        r = await ejecutar(sesion);
        aviso = '_Nota: esta conversación arrancó una memoria nueva; la anterior no se encontró._\n\n';
      }

      // El id de la sesión lo fija SIEMPRE el puente (--session-id); nunca se
      // adopta el que diga el proceso. Si no coinciden, algo raro pasó.
      if (r.resultado) estado.marcarIniciada(idConversation, sesion.id);
      if (r.sessionId && r.sessionId !== sesion.id) {
        log(`conversación ${idConversation}: el proceso reportó otra sesión (${r.sessionId}); se conserva ${sesion.id}.`);
      }

      let cuerpo;
      if (r.abortado) {
        cuerpo = r.abortado.startsWith('arranque inseguro')
          ? 'No pude atender el mensaje: el proceso arrancó con permisos que este puente no admite y se detuvo por seguridad. Avísele a Tecnología.'
          : 'No alcancé a terminar dentro del tiempo permitido. Intente con una pregunta más acotada.';
        log(`conversación ${idConversation}: turno abortado (${r.abortado})`);
      } else if (!r.resultado?.ok) {
        cuerpo = 'No pude completar la respuesta por un error del asistente. Intente de nuevo en unos minutos.';
        log(`conversación ${idConversation}: turno con error (código ${r.codigo}, ${r.resultado?.subtipo ?? 'sin resultado'})`);
      } else {
        cuerpo = r.resultado.texto.trim() || '_(El asistente terminó sin texto.)_';
      }
      cuerpo = (aviso + cuerpo).slice(0, MAX_RESPUESTA);

      await synerlink.responder(idConversation, cuerpo);

      const fin = new Date();
      if (r.tokens) {
        const reporte = {
          idConversation,
          sessionId: sesion.id,
          models: r.modelos ?? [],
          apiMessages: r.apiMessages ?? 0,
          apiMessagesSubagents: r.apiMessagesSubagents ?? 0,
          tokens: r.tokens,
          turnStartedAt: inicio.toISOString(),
          turnEndedAt: fin.toISOString(),
        };
        registrarConsumoLocal(cfg.hilosDir, {
          ...reporte,
          idProject: contexto.project.idProject,
          costoUsd: r.costoUsd ?? null,
          mensajes: ids.length,
        });
        const total = r.tokens.input + r.tokens.cacheCreation + r.tokens.cacheRead + r.tokens.output;
        if (total > 0) await synerlink.consumo(reporte).catch((e) => log('no se pudo reportar el consumo:', e.message));
      }
    } catch (err) {
      log(`conversación ${idConversation}: error atendiendo el turno:`, err?.message ?? err);
      await synerlink
        .responder(idConversation, 'No pude atender el mensaje por un error del puente. Tecnología ya quedó con el registro.')
        .catch(() => null);
    } finally {
      // Se confirma SIEMPRE al final (éxito o error ya avisado): con ack=false
      // en la bandeja, si el puente se cae a mitad de turno, el mensaje vuelve
      // a llegar al reiniciar (al menos una vez).
      await synerlink.confirmar(ids).catch((e) => log('no se pudo confirmar:', e.message));
      for (const id of ids) enProceso.delete(id);
      await synerlink.estado(idConversation, 'idle', null, []).catch(() => null);
    }
  }

  const cola = new ColaHilos({
    maxConcurrencia: cfg.maxConcurrencia,
    ejecutar: atender,
    alEsperar: (clave) =>
      void synerlink
        .estado(Number(clave), 'thinking', `En espera: el asistente atiende otras ${cfg.maxConcurrencia} conversaciones…`)
        .catch(() => null),
    alError: (clave, err) => log(`conversación ${clave}: error no controlado:`, err?.message ?? err),
  });

  /** Mete a la cola lo que llegue y no esté ya en proceso. Devuelve cuántos nuevos. */
  function recibir(mensajes) {
    let nuevos = 0;
    for (const m of mensajes) {
      if (enProceso.has(m.id)) continue;
      if (m.conversation?.kind !== 'project') continue; // defensa: la bandeja ya filtra
      enProceso.add(m.id);
      cola.encolar(String(m.idConversation), m);
      nuevos += 1;
    }
    return nuevos;
  }

  return { recibir, cola, enProceso, atender };
}

async function principal() {
  const cfg = cargarConfig(process.env);
  verificarClaude(cfg.claudeBin);
  mkdirSync(cfg.configClaudeDir, { recursive: true, mode: 0o700 });

  const synerlink = crearClienteSynerLink({ url: cfg.url, llave: cfg.llave });
  const primera = await synerlink.bandeja(0);
  verificarBandeja(primera, cfg.agente);
  cfg.agenteNombre = primera.agent.displayName;

  const estado = new Estado(cfg.hilosDir);
  const puente = crearPuente({ cfg, synerlink, estado });
  log(`listo: agente ${cfg.agente} (${cfg.agenteNombre}), entorno ${cfg.entorno}, tope ${cfg.maxConcurrencia} hilos, credencial: ${cfg.origenCredencial}.`);

  let parar = false;
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.on(senal, () => {
      log(`recibí ${senal}: termino los turnos en curso y salgo.`);
      parar = true;
      void puente.cola.vacia().then(() => process.exit(0));
      setTimeout(() => process.exit(0), cfg.timeoutTurnoMs).unref();
    });
  }

  puente.recibir(primera.messages ?? []);
  let espera = 1000;
  while (!parar) {
    try {
      const r = await synerlink.bandeja(25);
      const nuevos = puente.recibir(r.messages ?? []);
      espera = 1000;
      // Con ack=false la bandeja devuelve lo pendiente aunque ya esté en la
      // cola: si no hubo nada nuevo pero sí pendientes, se respira un poco
      // para no martillar la base mientras el turno corre.
      if (nuevos === 0 && (r.messages ?? []).length > 0) await new Promise((res) => setTimeout(res, 3000));
    } catch (err) {
      log('bandeja:', err?.message ?? err);
      if (err?.status === 401 || err?.status === 404) {
        log('la llave dejó de valer o los proyectos se apagaron: salgo.');
        process.exit(2);
      }
      await new Promise((res) => setTimeout(res, espera));
      espera = Math.min(espera * 2, 60_000);
    }
  }
}

/** ¿Este módulo es el punto de entrada? Con rutas reales: el despliegue usa un symlink. */
function esPuntoDeEntrada() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (esPuntoDeEntrada()) {
  principal().catch((err) => {
    console.error(new Date().toISOString(), '[puente-hilos] no arranca:', err?.message ?? err);
    process.exit(1);
  });
}
