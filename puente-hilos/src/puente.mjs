#!/usr/bin/env node
/**
 * PUENTE DE HILOS — SynerLink (proyectos) ⇄ Claude Code, una sesión por hilo.
 * F1 piloto (Play, solo PRUEBAS), aprobado por Nicolás Rivera el 2026-10-17.
 * Producción con instancia propia y separada (HILOS_ENTORNO=produccion), 2026-10-20.
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
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarConfig, ErrorConfig, sellarEntorno } from './config.mjs';
import { appendFileSync } from 'node:fs';
import {
  cargarReposPorProyecto,
  entornoCodigo,
  estadoDependencias,
  rutaCacheNpm,
  leerTokenGithub,
  permisosCodigo,
  prepararHomeCodigo,
  hooksCodigo,
  prepararWorktrees,
  sandboxCodigo,
  textoCodigo,
  textoIndiceRepos,
  reposDelTurno,
  registrarReposSolicitados,
  turnoAutorizado,
} from './codigo.mjs';
import { ColaHilos } from './cola.mjs';
import { combinarPerfil, prepararConectoresTurno, secretosConectores } from './conectores.mjs';
import { guiaDesarrolloSegura } from './guia.mjs';
import { prepararMemoriaTurno } from './memoria.mjs';
import { crearClienteSynerLink } from './synerlink.mjs';
import { armarArgumentos, armarArgumentosSugerencia, armarEntorno, correrTurno, etiquetaHerramienta } from './claude.mjs';
import {
  argumentosEquipo,
  armarAgentes,
  armarPromptSugerencia,
  catalogoDisponible,
  crearVigia,
  equipoDelTurno,
  esquemaSugerencia,
  tareasIndicador,
  textoEquipoPrincipal,
  topesEfectivos,
  validarSugerencia,
} from './equipo.mjs';
import {
  armarPrompt,
  asegurarCarpetas,
  bajarAdjuntos,
  escribirContexto,
  leerPropuestas,
  limpiarPropuestas,
  Estado,
  registrarConsumoLocal,
  rutasDelHilo,
  sincronizarArchivos,
} from './hilos.mjs';

const MAX_RESPUESTA = 40_000;

/** Etiqueta del entorno en CADA línea del log; se fija al cargar la configuración. */
let etiquetaEntorno = '';
export function fijarEtiquetaEntorno(entorno) {
  etiquetaEntorno = entorno ? `[${entorno}]` : '';
}

function log(...partes) {
  console.log(new Date().toISOString(), '[puente-hilos]', ...(etiquetaEntorno ? [etiquetaEntorno] : []), ...partes);
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

/** Quita el token de GitHub de cualquier texto antes de publicarlo o registrarlo. */
export function ocultarSecreto(texto, secreto) {
  if (!secreto || typeof texto !== 'string') return texto;
  return texto.split(secreto).join('[token oculto]');
}

/**
 * Acceso al código del turno (nivel 2). Devuelve null si el proyecto no tiene
 * repos vinculados. Si algo falla, el turno corre SIN código (falla cerrado).
 */
export function prepararCodigoTurno({ cfg, idProject, idConversation, rutas, lote, agenteNombre, conEquipo = false, cargar = cargarReposPorProyecto, preparar = prepararWorktrees, elegirRepos = reposDelTurno, leerToken = leerTokenGithub, prepararHome = prepararHomeCodigo }) {
  if (!cfg.rutaReposPorProyecto) return null;
  const vinculos = cargar(cfg.rutaReposPorProyecto);
  const proyecto = vinculos?.proyectos.get(idProject);
  if (!proyecto) return null;
  const token = leerToken(cfg.githubTokenArchivo);
  const homeCodigo = prepararHome(cfg.hilosDir, agenteNombre, cfg.home);
  const envGit = { PATH: cfg.path, HOME: homeCodigo, GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', LANG: 'en_US.UTF-8' };
  // Bajo demanda (proyectos con muchos repos): solo se montan los que hacen falta.
  const disponibles = proyecto.repos.map((n) => vinculos.repos.get(n));
  const aMontar = elegirRepos({ proyecto, repos: vinculos.repos, lote, rutas });
  const { autorizado, autores } = turnoAutorizado(lote, vinculos.operadores);
  if (aMontar.length === 0) {
    // Ningún repo nombrado todavía: el turno va SIN código (sin Bash, sin token),
    // pero con el índice para que Orus sepa qué hay y cómo pedirlo.
    return { soloIndice: true, disponibles, bajoDemanda: true, bloque: textoIndiceRepos({ disponibles, montados: [] }) };
  }
  const worktrees = preparar({ repos: aMontar, rutas, idProject, idConversation, envGit }).map((w) => ({ ...w, dependencias: w.dependencias ?? estadoDependencias(w.worktree) }));
  const cacheNpm = rutaCacheNpm(cfg.hilosDir); // la crea prepararHomeCodigo
  const permisos = permisosCodigo({ repos: worktrees, autorizado, pases: proyecto.pases });
  return {
    ...permisos,
    autorizado,
    autores,
    worktrees,
    token,
    sandbox: sandboxCodigo({ worktrees, homeReal: cfg.home, homeCodigo, hilosDir: cfg.hilosDir, secretos: [cfg.githubTokenArchivo, ...secretosConectores(cfg)], cacheNpm }),
    entorno: entornoCodigo({ token, homeCodigo, cacheNpm }),
    hooks: hooksCodigo(),
    disponibles,
    bajoDemanda: proyecto.bajoDemanda,
    bloque:
      textoCodigo({ worktrees, autorizado, puedePasar: permisos.puedePasar, autores, operadores: vinculos.operadores, equipo: conEquipo }) +
      (proyecto.bajoDemanda ? `\n${textoIndiceRepos({ disponibles, montados: worktrees })}` : ''),
  };
}

export function crearPuente({ cfg, synerlink, estado, correr = correrTurno }) {
  const enProceso = new Set();

  /** Auditoría local de cada comando y cada negación en turnos con código (sin el token). */
  function auditarCodigo(idConversation, evento, codigo) {
    try {
      const filas = [];
      if (evento?.type === 'assistant') {
        for (const c of evento.message?.content ?? []) {
          if (c?.type === 'tool_use' && c.name === 'Bash') filas.push({ tipo: 'bash', comando: String(c.input?.command ?? '').slice(0, 2000) });
        }
      } else if (evento?.type === 'result' && Array.isArray(evento.permission_denials) && evento.permission_denials.length > 0) {
        for (const d of evento.permission_denials) filas.push({ tipo: 'negado', herramienta: d?.tool_name, entrada: JSON.stringify(d?.tool_input ?? {}).slice(0, 2000) });
      }
      for (const f of filas) {
        const linea = JSON.stringify({ ts: new Date().toISOString(), idConversation, autorizado: codigo.puedePasar, ...f });
        appendFileSync(path.join(cfg.hilosDir, 'auditoria-codigo.jsonl'), `${ocultarSecreto(linea, codigo.token)}\n`, { mode: 0o600 });
      }
    } catch {}
  }

  async function atender(claveConv, lote) {
    const idConversation = Number(claveConv);
    const ids = lote.map((m) => m.id);
    const inicio = new Date();
    try {
      await synerlink.estado(idConversation, 'thinking', 'Preparando el proyecto…').catch(() => null);

      const contexto = await synerlink.contexto(idConversation);
      const perfilBase = cfg.perfiles.get(contexto.project.profile.key);
      if (!perfilBase) {
        // Perfil que este puente no conoce: no se improvisa ningún conector.
        await synerlink.responder(
          idConversation,
          `No puedo atender este proyecto: su perfil de conectores («${contexto.project.profile.label}») no está configurado en el puente. Avísele a Tecnología.`
        );
        return;
      }

      // Conectores por proyecto (bases en SOLO LECTURA): se SUMAN al perfil solo en los
      // proyectos vinculados y en turnos de un lector autorizado. Si algo falla, el turno
      // va con el perfil tal cual (falla cerrado).
      let conectores = null;
      let avisoConectores = '';
      try {
        conectores = prepararConectoresTurno({ cfg, idProject: contexto.project.idProject, lote });
        if (conectores?.motivo) log(`conversación ${idConversation}: turno sin conectores del proyecto (${conectores.motivo}).`);
        else if (conectores) log(`conversación ${idConversation}: conectores del proyecto: ${conectores.servidores.map((x) => x.nombre).join(', ')}.`);
      } catch (e) {
        conectores = null;
        log(`conversación ${idConversation}: no se pudieron preparar los conectores del proyecto, el turno va sin ellos:`, e.message);
        avisoConectores = '_Nota: no pude preparar los conectores de bases de datos del proyecto en este turno; respondí sin ellos. Tecnología quedó con el registro._\n\n';
      }
      const perfil = combinarPerfil(perfilBase, conectores);

      const rutas = rutasDelHilo(cfg.hilosDir, contexto.project.idProject, idConversation);
      asegurarCarpetas(rutas);
      await sincronizarArchivos({ rutas, contexto, estado, descargar: (u) => synerlink.descargar(u) });
      const adjuntos = await bajarAdjuntos({ rutas, mensajes: lote, descargar: (u) => synerlink.descargar(u) });
      // Equipo de subagentes (F2): SOLO el aprobado en SynerLink, con topes. Si
      // algo del equipo no valida, el turno corre SIN equipo (falla cerrado).
      const agenteNombre = cfg.agenteNombre ?? cfg.agente;
      let equipo = null;
      let avisoEquipo = '';
      try {
        equipo = equipoDelTurno(contexto, cfg);
      } catch (e) {
        log(`conversación ${idConversation}: equipo inválido, el turno va sin subagentes:`, e.message);
        avisoEquipo = '_Nota: el equipo de subagentes del proyecto no se pudo cargar; respondí sin él._\n\n';
      }
      const topes = topesEfectivos(equipo, cfg);
      // Acceso al código (nivel 2): repos vinculados al proyecto, worktree propio y
      // pases solo si TODOS los mensajes del turno son de un operador autorizado.
      let codigo = null;
      let indiceRepos = null; // proyecto bajo demanda: índice de repos y registro de los que Orus pida
      let avisoCodigo = '';
      try {
        codigo = prepararCodigoTurno({ cfg, idProject: contexto.project.idProject, idConversation, rutas, lote, agenteNombre, conEquipo: Boolean(equipo) });
        if (codigo?.soloIndice) {
          indiceRepos = codigo;
          codigo = null;
          log(`conversación ${idConversation}: código bajo demanda, ningún repo montado todavía (${indiceRepos.disponibles.length} disponibles).`);
        } else if (codigo) {
          if (codigo.bajoDemanda) indiceRepos = codigo;
          log(
            `conversación ${idConversation}: código ${codigo.worktrees.map((w) => `${w.nombre}@${w.rama}`).join(', ')}; pases ${codigo.puedePasar ? 'AUTORIZADOS' : 'no'} (autores: ${codigo.autores.join(', ')}).`
          );
        }
      } catch (e) {
        codigo = null;
        log(`conversación ${idConversation}: no se pudo preparar el acceso al código, el turno va sin él:`, e.message);
        avisoCodigo = '_Nota: no pude preparar el acceso al código del proyecto en este turno; respondí sin él. Tecnología quedó con el registro._\n\n';
      }
      // El equipo se arma DESPUÉS del código: sus subagentes leen el worktree y usan git de lectura.
      const equipoTurno = equipo
        ? {
            bloque: textoEquipoPrincipal({ equipo, topes }),
            agentes: armarAgentes({ equipo, perfil, agente: agenteNombre, proyecto: contexto.project, topes, codigo }),
          }
        : null;
      // Memoria del bot principal, en solo lectura (copia renovada en cada turno).
      const memoria = prepararMemoriaTurno({ cfg, rutas, lote, agenteNombre });
      if (memoria.motivo) log(`conversación ${idConversation}: turno sin memoria (${memoria.motivo}).`);
      else if (memoria.archivos) log(`conversación ${idConversation}: memoria ${memoria.archivos.length} archivos${memoria.excluidos.length ? `; excluidos por seguridad: ${memoria.excluidos.map((x) => `${x.archivo} (${x.motivo})`).join(', ')}` : ''}.`);
      // Proyecto con código (nivel 2): el resumen corto del flujo de pases va con las reglas del código.
      let bloqueGuia = '';
      if (codigo || indiceRepos) {
        const g = guiaDesarrolloSegura();
        if (g.error) log(`conversación ${idConversation}: la guía del flujo de desarrollo no se cargó: ${g.error}`);
        bloqueGuia = g.bloque;
      }
      escribirContexto({
        rutas,
        agente: agenteNombre,
        contexto,
        perfil,
        instruccionesEn: cfg.instruccionesEn,
        equipoTurno,
        bloqueCodigo: (codigo?.bloque ?? indiceRepos?.bloque ?? '') + (bloqueGuia ? `\n${bloqueGuia}` : ''),
        bloqueMemoria: memoria.bloque,
        bloqueConectores: conectores?.bloque ?? '',
      });
      limpiarPropuestas(rutas);
      let vigia = null;

      const ejecutar = async (sesion) => {
        const args = armarArgumentos({
          perfil,
          sesion,
          rutaMcp: rutas.mcp,
          rutaSistema: rutas.sistema,
          dirArchivos: rutas.archivos,
          modelo: cfg.modelo,
          // Con equipo, el tope de gasto POR PEDIDO es obligatorio.
          presupuestoUsd: equipo ? topes.presupuestoUsd : cfg.presupuestoUsd,
          equipo: equipo ? argumentosEquipo({ equipo, rutaAgentes: rutas.agentes }) : null,
          codigo,
        });
        let ultimaEtiqueta = null;
        let ultimosActivos = '';
        vigia = equipo ? crearVigia({ equipo, perfil, conCodigo: Boolean(codigo) }) : null;
        // Para reproducir el turno tal cual: los argumentos exactos (sin secretos: el entorno no va).
        try {
          writeFileSync(path.join(rutas.puente, 'ultimo-comando.json'), JSON.stringify({ ts: new Date().toISOString(), bin: cfg.claudeBin, cwd: rutas.cwd, args }, null, 2), { mode: 0o600 });
        } catch {}
        return correr({
          bin: cfg.claudeBin,
          args,
          env: armarEntorno(cfg, equipo ? topes : null, codigo?.entorno ?? null),
          cwd: rutas.cwd,
          prompt: armarPrompt(lote, adjuntos),
          perfil,
          equipo,
          codigo,
          vigia,
          timeoutMs: cfg.timeoutTurnoMs,
          alEvento: (evento, acc) => {
            if (codigo) auditarCodigo(idConversation, evento, codigo);
            // La tablita de sub-agentes del chat: se actualiza cuando cambia
            // el conjunto de subagentes que están trabajando.
            if (vigia) {
              const activos = vigia.activos();
              const clave = activos.map((c) => c.toolUseId).join(',');
              if (clave !== ultimosActivos) {
                ultimosActivos = clave;
                const etiqueta = activos.length > 0 ? `Trabajando con ${activos.length === 1 ? '1 subagente' : `${activos.length} subagentes`}…` : 'Consolidando lo del equipo…';
                ultimaEtiqueta = etiqueta;
                void synerlink.estado(idConversation, 'tool', etiqueta, tareasIndicador(activos)).catch(() => null);
                return;
              }
              if (evento.parent_tool_use_id) return; // lo de adentro de un subagente no mueve la etiqueta
            }
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
          : r.abortado.startsWith('subagente fuera')
            ? 'Detuve el trabajo por seguridad: un subagente intentó salirse de lo aprobado para el equipo del proyecto. Tecnología quedó con el registro; puede intentar de nuevo.'
            : 'No alcancé a terminar dentro del tiempo permitido. Intente con una pregunta más acotada.';
        log(`conversación ${idConversation}: turno abortado (${r.abortado})`);
      } else if (/budget/i.test(r.resultado?.subtipo ?? '')) {
        cuerpo = `Llegué al tope de gasto de este pedido${equipo ? ` (${topes.presupuestoUsd} USD con el equipo de subagentes)` : ''} y me detuve antes de terminar. Intente con una pregunta más acotada o pídale menos frentes a la vez.`;
        log(`conversación ${idConversation}: tope de gasto alcanzado (${r.resultado.subtipo})`);
      } else if (!r.resultado?.ok) {
        cuerpo = 'No pude completar la respuesta por un error del asistente. Intente de nuevo en unos minutos.';
        log(`conversación ${idConversation}: turno con error (código ${r.codigo}, ${r.resultado?.subtipo ?? 'sin resultado'})`);
      } else {
        cuerpo = r.resultado.texto.trim() || '_(El asistente terminó sin texto.)_';
      }
      // Propuestas de tareas que dejó el modelo: se entregan con la llave del
      // PUENTE (el modelo nunca la ve) y quedan pendientes de confirmación.
      let notaPropuestas = '';
      const prop = leerPropuestas(rutas);
      if (prop.error) log(`conversación ${idConversation}: ${prop.error}`);
      if (r.resultado?.ok && prop.items.length > 0) {
        try {
          const res = await synerlink.proponer(idConversation, prop.items);
          const n = res?.creadas?.length ?? 0;
          const m = res?.rechazadas?.length ?? 0;
          if (n > 0) notaPropuestas += `\n\n📌 Dejé ${n === 1 ? '1 propuesta' : `${n} propuestas`} en el **Cronograma** del proyecto. Nada cambia hasta que un dueño o editor la${n === 1 ? '' : 's'} confirme.`;
          if (m > 0) notaPropuestas += `\n\n⚠️ ${m === 1 ? '1 propuesta no se pudo registrar' : `${m} propuestas no se pudieron registrar`}: ${res.rechazadas.map((x) => x.error).slice(0, 3).join(' · ')}`;
        } catch (e) {
          log(`conversación ${idConversation}: no se pudieron entregar las propuestas:`, e.message);
          notaPropuestas = '\n\n⚠️ No pude registrar mis propuestas en el Cronograma por un error. Intente de nuevo.';
        }
      }
      cuerpo = (aviso + avisoEquipo + avisoCodigo + avisoConectores + cuerpo).slice(0, MAX_RESPUESTA - notaPropuestas.length) + notaPropuestas;
      if (codigo) cuerpo = ocultarSecreto(cuerpo, codigo.token);
      // Bajo demanda: los repos que Orus nombró en su respuesta se montan desde el siguiente turno.
      if (indiceRepos && r.resultado?.ok) {
        try {
          const pedidos = registrarReposSolicitados(rutas, r.resultado.texto, indiceRepos.disponibles);
          if (pedidos.length) log(`conversación ${idConversation}: repos nombrados por el asistente, se montan en el siguiente turno: ${pedidos.join(', ')}.`);
        } catch (e) {
          log(`conversación ${idConversation}: no se pudieron registrar los repos pedidos:`, e.message);
        }
      }

      await synerlink.responder(idConversation, cuerpo);

      const fin = new Date();
      // Lo que hizo cada subagente: a SynerLink (sección Equipo) y a consumo.jsonl.
      if (vigia && vigia.corridas().length > 0) {
        vigia.cerrar('cancelado');
        const reporteEquipo = {
          idConversation,
          sessionId: sesion.id,
          turnStartedAt: inicio.toISOString(),
          blocked: vigia.violaciones().slice(0, 5),
          runs: vigia.corridas().map((c) => ({
            slug: c.slug,
            description: c.descripcion,
            status: c.estado,
            startedAt: new Date(c.inicio).toISOString(),
            endedAt: c.fin ? new Date(c.fin).toISOString() : null,
            durationMs: c.duracionMs,
            totalTokens: c.tokens,
            toolUses: c.herramientas,
            model: c.modelo,
          })),
        };
        registrarConsumoLocal(cfg.hilosDir, { tipo: 'subagentes', idProject: contexto.project.idProject, ...reporteEquipo });
        await synerlink.corridas(reporteEquipo).catch((e) => log('no se pudo registrar lo del equipo:', e.message));
      }
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

  /**
   * «Sugerir equipo»: UN `claude -p` sin herramientas, sin conectores y sin
   * sesión, con salida estructurada. Lo que devuelve queda PROPUESTO en
   * SynerLink hasta que el dueño lo apruebe. Pasa por la misma cola (cuenta
   * dentro del tope de hilos simultáneos).
   */
  async function sugerirEquipo(pedido) {
    const idRequest = pedido?.idRequest;
    try {
      const idProject = Number(pedido?.idProject);
      if (!Number.isInteger(idProject) || idProject <= 0) throw new Error('pedido sin proyecto');
      const perfil = cfg.perfiles.get(pedido.project?.profileKey);
      if (!perfil) {
        await synerlink.entregarSugerencia(idRequest, { error: 'El perfil de conectores del proyecto no está configurado en el puente.' });
        return;
      }
      const disponibles = catalogoDisponible(perfil);
      const dir = path.join(cfg.hilosDir, 'proyectos', String(idProject), 'equipo');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const rutaMcp = path.join(dir, 'mcp-vacio.json');
      writeFileSync(rutaMcp, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
      const r = await correr({
        bin: cfg.claudeBin,
        args: armarArgumentosSugerencia({
          rutaMcp,
          esquema: esquemaSugerencia(disponibles),
          modelo: cfg.modelo,
          presupuestoUsd: cfg.sugerenciaPresupuestoUsd,
        }),
        env: armarEntorno(cfg, null),
        cwd: dir,
        prompt: armarPromptSugerencia({ brief: pedido, disponibles, agente: cfg.agenteNombre ?? cfg.agente }),
        perfil: { mcpServers: {}, herramientas: [], web: false },
        timeoutMs: cfg.sugerenciaTimeoutMs,
      });
      const items = r.resultado?.ok ? validarSugerencia(r.salidaEstructurada, disponibles) : [];
      const consumo = r.tokens ? { tokens: r.tokens, models: r.modelos ?? [] } : {};
      if (items.length === 0) {
        log(`pedido de equipo ${idRequest}: sin sugerencia (${r.abortado ?? r.resultado?.subtipo ?? `código ${r.codigo}`})`);
        await synerlink.entregarSugerencia(idRequest, { error: 'El asistente no pudo armar una propuesta de equipo. Intente de nuevo en unos minutos.', ...consumo });
        return;
      }
      await synerlink.entregarSugerencia(idRequest, { items, ...consumo });
    } catch (err) {
      log(`pedido de equipo ${idRequest}: error:`, err?.message ?? err);
      await synerlink.entregarSugerencia(idRequest, { error: 'El asistente no pudo armar una propuesta de equipo por un error del puente.' }).catch(() => null);
    }
  }

  const PREFIJO_EQUIPO = 'equipo:';
  const cola = new ColaHilos({
    maxConcurrencia: cfg.maxConcurrencia,
    ejecutar: (clave, lote) => (clave.startsWith(PREFIJO_EQUIPO) ? sugerirEquipo(lote[0]).finally(() => enProceso.delete(clave)) : atender(clave, lote)),
    alEsperar: (clave) =>
      clave.startsWith(PREFIJO_EQUIPO)
        ? undefined
        : void synerlink
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

  /** Mete a la cola los pedidos de «Sugerir equipo» (ya reclamados por el servidor). */
  function recibirPedidos(pedidos) {
    let nuevos = 0;
    for (const p of pedidos ?? []) {
      const clave = `${PREFIJO_EQUIPO}${p?.idRequest}`;
      if (!Number.isInteger(p?.idRequest) || enProceso.has(clave)) continue;
      enProceso.add(clave);
      cola.encolar(clave, p);
      nuevos += 1;
    }
    return nuevos;
  }

  return { recibir, recibirPedidos, cola, enProceso, atender, sugerirEquipo };
}

async function principal() {
  const cfg = cargarConfig(process.env);
  fijarEtiquetaEntorno(cfg.entorno);
  verificarClaude(cfg.claudeBin);
  mkdirSync(cfg.hilosDir, { recursive: true, mode: 0o700 });
  if (sellarEntorno(cfg)) log(`carpeta ${cfg.hilosDir} sellada como ${cfg.entorno} (${cfg.url}).`);
  mkdirSync(cfg.configClaudeDir, { recursive: true, mode: 0o700 });

  const synerlink = crearClienteSynerLink({ url: cfg.url, llave: cfg.llave });
  const primera = await synerlink.bandeja(0);
  verificarBandeja(primera, cfg.agente);
  cfg.agenteNombre = primera.agent.displayName;

  const estado = new Estado(cfg.hilosDir);
  const puente = crearPuente({ cfg, synerlink, estado });
  log(`listo: agente ${cfg.agente} (${cfg.agenteNombre}), entorno ${cfg.entorno}, tope ${cfg.maxConcurrencia} hilos, credencial: ${cfg.origenCredencial}, modelo del hilo principal: ${cfg.modelo ?? 'el predeterminado de la cuenta (sin HILOS_MODELO)'}.`);

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
  // «Sugerir equipo»: se revisa entre vueltas de la bandeja, cada 15 s como mucho.
  let ultimaRevisionEquipo = 0;
  let equipoDisponible = true;
  while (!parar) {
    if (equipoDisponible && Date.now() - ultimaRevisionEquipo > 15_000) {
      ultimaRevisionEquipo = Date.now();
      try {
        const p = await synerlink.pedidosEquipo();
        puente.recibirPedidos(p?.requests ?? []);
      } catch (err) {
        if (err?.status === 404) {
          // SynerLink todavía no trae el equipo de subagentes: no se insiste.
          equipoDisponible = false;
          log('SynerLink no trae «Sugerir equipo» (404): no se revisa más en esta ejecución.');
        } else log('pedidos de equipo:', err?.message ?? err);
      }
    }
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
    const entorno = (process.env.HILOS_ENTORNO ?? '').trim();
    console.error(new Date().toISOString(), '[puente-hilos]', ...(entorno ? [`[${entorno}]`] : []), 'no arranca:', err?.message ?? err);
    process.exit(1);
  });
}
