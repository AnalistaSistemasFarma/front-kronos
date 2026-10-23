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
  permisosTerminalCompleta,
  textoTerminalCompleta,
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
import { analizarComando, catalogoPlugins, encabezadoObjetivo, MAX_REVISIONES_OBJETIVO, SKILLS_CON_GIT, estadoObjetivoSesion, resolverComando, rutaTranscripcion, skillsDePlugins, textoObjetivo } from './comandos.mjs';
import { combinarPerfil, prepararConectoresTurno, secretosConectores } from './conectores.mjs';
import { borrarMcpAgente, perfilConAgente, prepararConectoresAgente, secretosConectoresAgente, servidoresAgente, textoConectoresAgente } from './conectores-agente.mjs';
import { guiaDesarrolloSegura } from './guia.mjs';
import { prepararPruebasTurno, secretosPruebas, verificarSecretosPruebas } from './pruebas-kronos.mjs';
import { grafosDelTurno, textoGrafos } from './grafos.mjs';
import { prepararMemoriaTurno } from './memoria.mjs';
import { crearClienteSynerLink } from './synerlink.mjs';
import { crearMedidorCuota } from './cuota.mjs';
import { crearArchivador, textoArchivarProyecto } from './archivar-proyecto.mjs';
import { prepararAdjuntos } from './adjuntos-salida.mjs';
import { archivosDelTurno, archivosModificadosDesde, crearSupervisor, duracionLegible, PROMPT_CONTINUACION, textoAvisoProgreso, textoCorte, textoTiempoTurno } from './progreso.mjs';
import { convertirHtmlAPdf, convertirMarcasPdf, recursosDePlugins, resolverChrome, textoPdf } from './pdf.mjs';
import { armarArgumentos, armarArgumentosCompleto, armarArgumentosSugerencia, armarEntorno, armarEntornoCompleto, correrTurno, etiquetaHerramienta } from './claude.mjs';
import { borrarMcpCompleto, encabezadoMensajeCompleto, filasAuditoriaCompleto, pluginsCompletos, prepararOrusCompleto, textoOrusCompleto, turnoOrusCompleto } from './orus-completo.mjs';
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
export function prepararCodigoTurno({ cfg, idProject, idConversation, rutas, lote, agenteNombre, conEquipo = false, completo = false, cargar = cargarReposPorProyecto, preparar = prepararWorktrees, elegirRepos = reposDelTurno, leerToken = leerTokenGithub, prepararHome = prepararHomeCodigo }) {
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
  // Terminal completa (autorizada por Nicolás, 2026-10-20): solo turnos de operadores.
  // Modo Orus completo (2026-10-22): siempre, en cualquier proyecto con repos (orus-completo.mjs).
  const terminal = (proyecto.terminalCompleta && autorizado) || completo === true;
  if (aMontar.length === 0 && !terminal) {
    // Ningún repo nombrado todavía: el turno va SIN código (sin Bash, sin token),
    // pero con el índice para que Orus sepa qué hay y cómo pedirlo.
    return { soloIndice: true, disponibles, bajoDemanda: true, bloque: textoIndiceRepos({ disponibles, montados: [] }) };
  }
  const worktrees = preparar({ repos: aMontar, rutas, idProject, idConversation, envGit }).map((w) => ({ ...w, dependencias: w.dependencias ?? estadoDependencias(w.worktree) }));
  const cacheNpm = rutaCacheNpm(cfg.hilosDir); // la crea prepararHomeCodigo
  const permisos = terminal ? permisosTerminalCompleta({ repos: worktrees, pases: proyecto.pases, cwd: rutas.cwd }) : permisosCodigo({ repos: worktrees, autorizado, pases: proyecto.pases, cwd: rutas.cwd });
  return {
    ...permisos,
    autorizado,
    autores,
    worktrees,
    token,
    // Terminal completa: sin sandbox y con la casa real (llaves SSH), como el Orus principal.
    sandbox: terminal ? { enabled: false } : sandboxCodigo({ worktrees, homeReal: cfg.home, homeCodigo, hilosDir: cfg.hilosDir, secretos: [cfg.githubTokenArchivo, ...secretosConectores(cfg), ...secretosPruebas(cfg), ...secretosConectoresAgente(cfg)], cacheNpm }),
    entorno: terminal ? { ...entornoCodigo({ token, homeCodigo, cacheNpm }), HOME: cfg.home } : entornoCodigo({ token, homeCodigo, cacheNpm }),
    hooks: hooksCodigo(),
    disponibles,
    bajoDemanda: proyecto.bajoDemanda,
    bloque:
      (worktrees.length ? textoCodigo({ worktrees, autorizado, puedePasar: permisos.puedePasar, autores, operadores: vinculos.operadores, equipo: conEquipo }) : '') +
      (terminal && completo !== true ? `\n${textoTerminalCompleta({ autores })}` : '') +
      (proyecto.bajoDemanda ? `\n${textoIndiceRepos({ disponibles, montados: worktrees })}` : ''),
  };
}

/** ¿Todos los mensajes del lote son de un operador autorizado (operadoresPases)? Falla cerrado. */
export function loteDeOperador(cfg, lote, cargar = cargarReposPorProyecto) {
  try {
    const v = cfg.rutaReposPorProyecto ? cargar(cfg.rutaReposPorProyecto) : null;
    return turnoAutorizado(lote, v?.operadores ?? []).autorizado;
  } catch {
    return false;
  }
}

/** Nombre de quien escribió el mensaje (para el registro del objetivo). */
function autorDe(m) {
  return m?.author?.name?.trim() || m?.author?.email || null;
}

export function crearPuente({ cfg, synerlink, estado, correr = correrTurno, convertirPdf = convertirHtmlAPdf, medidor = null }) {
  const enProceso = new Set();
  // Lo que el hilo adjunta queda también en los Archivos del proyecto (2026-10-23; HILOS_ARCHIVAR_EN_PROYECTO=no lo apaga).
  const archivador = cfg.archivarEnProyecto === false ? null : crearArchivador({ synerlink, log });

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

  /** Auditoría del MODO ORUS COMPLETO: inicio del turno, cada herramienta y cada negación (sin secretos). */
  function auditarCompleto(idConversation, fila, codigo = null) {
    try {
      const linea = JSON.stringify({ ts: new Date().toISOString(), idConversation, modo: 'orus-completo', ...fila });
      appendFileSync(path.join(cfg.hilosDir, 'auditoria-codigo.jsonl'), `${ocultarSecreto(linea, codigo?.token)}\n`, { mode: 0o600 });
    } catch {}
  }

  async function atender(claveConv, lote) {
    const idConversation = Number(claveConv);
    const ids = lote.map((m) => m.id);
    const inicio = new Date();
    // Supervisión del turno (progreso.mjs): avisos «sigo trabajando» y latido del indicador.
    let supervisor = null;
    // Modo Orus completo (orus-completo.mjs): el mcp.json del turno se borra siempre al final.
    let completo = null;
    // Conectores del agente (conectores-agente.mjs): su mcp.json (600, fuera del hilo) se borra al final.
    let delAgente = null;
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

      // Comandos «/x» (comandos.mjs): lista blanca. Los que responde el puente no corren el modelo;
      // los nativos van TAL CUAL al `claude -p`, con las MISMAS herramientas y permisos de siempre.
      let comando = null;
      let catalogo = null;
      let operador = false;
      // Turno de un autor del modo completo (identidad del servidor): plugin «orus» completo (sin exclusiones).
      const turnoCompleto = turnoOrusCompleto(lote, cfg.orusCompleto?.autores).activo;
      const pluginDirsTurno = turnoCompleto ? pluginsCompletos(cfg.pluginDirs ?? [], cfg.orusCompleto?.plugin) : (cfg.pluginDirs ?? []);
      if (lote.some((m) => analizarComando(m?.body))) {
        catalogo = catalogoPlugins(pluginDirsTurno);
        operador = loteDeOperador(cfg, lote);
        comando = resolverComando({ lote, catalogo, operador });
        if (comando) log(`conversación ${idConversation}: comando ${comando.accion}${comando.nombre ? ` /${comando.nombre}` : ''}${operador ? ' (operador)' : ''}.`);
      }
      if (comando?.accion === 'responder') {
        await synerlink.responder(idConversation, comando.texto);
        return;
      }
      if (comando?.accion === 'limpiar') {
        estado.reiniciarSesion(idConversation);
        await synerlink.responder(
          idConversation,
          '🧹 Listo: este hilo arranca una **memoria nueva** desde el próximo mensaje. El historial del chat sigue aquí, pero el asistente ya no lo tiene presente; si hace falta algo de antes, péguelo o resúmalo. Si había un objetivo (/goal), también se quitó.'
        );
        return;
      }
      if (comando?.accion === 'objetivo-ver') {
        const o = estado.objetivoDe(idConversation);
        await synerlink.responder(
          idConversation,
          o
            ? `🎯 **Objetivo activo** de esta conversación (/goal): «${o.condicion}»\n\nLo fijó ${o.autor ?? 'una persona del proyecto'} el ${String(o.fijado).slice(0, 10)}. El asistente sigue trabajando hacia él en cada mensaje hasta que un evaluador confirme que se cumplió. Para quitarlo: \`/goal clear\`.`
            : 'Esta conversación no tiene un objetivo activo. Para fijar uno: `/goal <condición>` (por ejemplo, `/goal el informe queda en PDF con las cifras de septiembre`).'
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
      let perfil = combinarPerfil(perfilBase, conectores);

      const rutas = rutasDelHilo(cfg.hilosDir, contexto.project.idProject, idConversation);
      asegurarCarpetas(rutas);
      // Base de PRUEBAS (lectura y escritura) y testing como QA: TODOS los proyectos, todos los
      // usuarios, con o sin terminal (pruebas-kronos.mjs). Si faltan credenciales, va sin ellos.
      const chromePdf = cfg.pdf?.habilitado === false ? null : resolverChrome({ explicito: cfg.pdf?.chrome ?? null, home: cfg.home });
      const pruebas = prepararPruebasTurno({ cfg, rutas, idConversation, lote, chrome: chromePdf ?? resolverChrome({ home: cfg.home }) });
      if (pruebas.servidores.length) perfil = combinarPerfil(perfil, pruebas);
      else if (pruebas.motivo && cfg.pruebasKronos?.habilitado) log(`conversación ${idConversation}: turno sin los conectores de PRUEBAS (${pruebas.motivo}).`);
      // MODO ORUS COMPLETO: todos los MCP del principal + los del puente, todas las herramientas, sin preguntas.
      // Si algo falla, el turno va en el modo normal (falla cerrado) y se dice en el hilo.
      let avisoCompleto = '';
      if (turnoCompleto) {
        try {
          completo = prepararOrusCompleto({ cfg, lote, idConversation, perfilServidores: perfil.mcpServers });
        } catch (e) {
          completo = null;
          log(`conversación ${idConversation}: no se pudo preparar el modo Orus completo, el turno va en el modo normal:`, e.message);
          avisoCompleto = '_Nota: no pude preparar el modo Orus completo en este turno; respondí con los permisos normales del hilo. Tecnología quedó con el registro._\n\n';
        }
        if (completo) {
          log(`conversación ${idConversation}: MODO ORUS COMPLETO (autores: ${completo.autores.join(', ')}); ${completo.servidores.length} conectores: ${completo.servidores.join(', ')}${completo.faltan.length ? `; variables sin valor: ${completo.faltan.join(', ')}` : ''}.`);
          auditarCompleto(idConversation, { tipo: 'inicio', idProject: contexto.project.idProject, autores: completo.autores, servidores: completo.servidores, plugins: completo.pluginDirs.map((d) => path.basename(d)) });
        }
      }
      // CONECTORES DEL AGENTE (los mismos de su chat), en todos los proyectos y para todos los usuarios.
      // En modo Orus completo no aplican (ese modo ya trae los del principal). Si fallan, va sin ellos.
      let avisoAgente = '';
      if (!completo && cfg.conectoresAgente) {
        try {
          delAgente = prepararConectoresAgente({ cfg, idConversation, perfilServidores: perfil.mcpServers });
          if (delAgente?.servidores.length) log(`conversación ${idConversation}: conectores del agente: ${delAgente.servidores.join(', ')}${delAgente.engramProyecto ? ` (engram → ${delAgente.engramProyecto})` : ''}${delAgente.faltan.length ? `; variables sin valor: ${delAgente.faltan.join(', ')}` : ''}.`);
        } catch (e) {
          delAgente = null;
          log(`conversación ${idConversation}: no se pudieron leer los conectores del agente, el turno va sin ellos:`, e.message);
          avisoAgente = '_Nota: no pude cargar mis conectores de siempre en este turno; respondí sin ellos. Tecnología quedó con el registro._\n\n';
        }
      }
      // Perfil del turno (permisos y revisión del init). El del proyecto sigue para el mcp.json del hilo y el equipo.
      const perfilTurno = perfilConAgente(perfil, delAgente);
      await sincronizarArchivos({ rutas, contexto, estado, descargar: (u) => synerlink.descargar(u) });
      const adjuntos = await bajarAdjuntos({ rutas, mensajes: lote, descargar: (u) => synerlink.descargar(u) });
      // Comando nativo: se resuelve otra vez ya con los adjuntos (una skill los recibe en sus argumentos).
      const nativo = comando?.accion === 'nativo' ? resolverComando({ lote, catalogo, operador, adjuntos }) : null;
      // /goal: el objetivo queda guardado POR CONVERSACIÓN (estado.json) y va en el encabezado de
      // cada turno; mientras esté vigente, el turno corre con hooks (los exige el /goal nativo).
      if (nativo?.objetivo?.fijar) estado.fijarObjetivo(idConversation, nativo.objetivo.fijar, autorDe(lote[0]));
      if (nativo?.objetivo?.quitar) estado.quitarObjetivo(idConversation);
      const objetivo = estado.objetivoDe(idConversation);
      const conObjetivo = Boolean(objetivo) || Boolean(nativo?.objetivo);
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
        codigo = prepararCodigoTurno({ cfg, idProject: contexto.project.idProject, idConversation, rutas, lote, agenteNombre, conEquipo: Boolean(equipo), completo: Boolean(completo) });
        if (codigo?.soloIndice) {
          indiceRepos = codigo;
          codigo = null;
          log(`conversación ${idConversation}: código bajo demanda, ningún repo montado todavía (${indiceRepos.disponibles.length} disponibles).`);
        } else if (codigo) {
          if (codigo.bajoDemanda) indiceRepos = codigo;
          log(
            `conversación ${idConversation}: código ${codigo.worktrees.map((w) => `${w.nombre}@${w.rama}`).join(', ') || '(ningún repo montado)'}; pases ${codigo.puedePasar ? 'AUTORIZADOS' : 'no'}${codigo.terminalCompleta ? '; TERMINAL COMPLETA (sin sandbox)' : ''} (autores: ${codigo.autores.join(', ')}).`
          );
        }
      } catch (e) {
        codigo = null;
        log(`conversación ${idConversation}: no se pudo preparar el acceso al código, el turno va sin él:`, e.message);
        avisoCodigo = '_Nota: no pude preparar el acceso al código del proyecto en este turno; respondí sin él. Tecnología quedó con el registro._\n\n';
      }
      // Skills incluidas que corren git al cargarse: solo con el código montado (comandos.mjs).
      if (nativo && SKILLS_CON_GIT.has(nativo.nombre) && !codigo && !completo) {
        await synerlink.responder(
          idConversation,
          `**/${nativo.nombre}** necesita el código del proyecto montado en este turno, y aquí no hay ningún repositorio montado${indiceRepos ? ' todavía. Nombre en un mensaje el repositorio que quiere revisar (se monta desde el siguiente) y vuelva a enviar el comando' : ': este proyecto no tiene repositorios vinculados (Tecnología los vincula)'}.`
        );
        return;
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
      // Grafos de Graphify de los repos MONTADOS en este turno (solo lectura).
      const grafosTurno = grafosDelTurno(cfg.grafosDir, codigo?.worktrees ?? []);
      // Recursos de solo lectura de los plugins (p. ej. gss-design) y HTML → PDF en el puente (pdf.mjs).
      // Para TODOS los turnos: con o sin código, con o sin terminal.
      const recursos = recursosDePlugins(cfg.pluginDirs ?? []);
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
        bloqueCodigo:
          (codigo?.bloque ?? indiceRepos?.bloque ?? '') +
          (bloqueGuia ? `\n${bloqueGuia}` : '') +
          textoGrafos(grafosTurno, { conBash: Boolean(codigo || completo) }) +
          (completo ? `\n${textoOrusCompleto({ autores: completo.autores, servidores: completo.servidores })}` : ''),
        bloqueMemoria: memoria.bloque,
        bloqueConectores: (conectores?.bloque ?? '') + (delAgente?.servidores.length ? textoConectoresAgente({ agente: agenteNombre, servidores: delAgente.servidores, origen: delAgente.origen, engramProyecto: delAgente.engramProyecto }) : ''),
        bloquePruebas: pruebas.bloque,
        bloquePdf: textoPdf({ disponible: Boolean(chromePdf), recursos }),
        bloqueTiempo: textoTiempoTurno({ topeMs: cfg.timeoutTurnoMs, avisoMs: cfg.avisoProgresoMs ?? 0 }),
        bloqueObjetivo: textoObjetivo(objetivo),
        bloqueArchivar: archivador ? textoArchivarProyecto() : '',
      });
      limpiarPropuestas(rutas);
      let vigia = null;
      // Lo que el indicador muestra ahora (el aviso y el latido lo conservan, nunca lo apagan),
      // y lo último que se sabe del turno para los avisos y el mensaje de corte.
      let indicador = { state: 'thinking', label: 'Pensando…' };
      let ultimoTexto = null;
      const tocados = new Set();

      const promptTurno = nativo?.prompt ?? armarPrompt(lote, adjuntos, (completo ? encabezadoMensajeCompleto(completo.autores) : '') + encabezadoObjetivo(objetivo));
      const ejecutar = async (sesion, prompt = promptTurno) => {
        const pluginsTurno = { dirs: pluginDirsTurno, dirsLectura: [...grafosTurno.map((g) => g.dir), ...recursos, ...skillsDePlugins(pluginDirsTurno)] };
        const args = completo
          ? armarArgumentosCompleto({
              completo,
              sesion,
              rutaSistema: rutas.sistema,
              dirArchivos: rutas.archivos,
              modelo: cfg.modelo,
              presupuestoUsd: cfg.presupuestoUsd,
              codigo,
              plugins: pluginsTurno,
              objetivo: conObjetivo,
              rutaAgentes: equipo ? rutas.agentes : null,
            })
          : armarArgumentos({
          perfil: perfilTurno,
          sesion,
          // Con conectores del agente, el mcp.json COMPLETO del turno va fuera del hilo (600).
          rutaMcp: delAgente?.rutaMcp ?? rutas.mcp,
          rutaSistema: rutas.sistema,
          dirArchivos: rutas.archivos,
          modelo: cfg.modelo,
          // Con equipo, el tope de gasto POR PEDIDO es obligatorio.
          presupuestoUsd: equipo ? topes.presupuestoUsd : cfg.presupuestoUsd,
          equipo: equipo ? argumentosEquipo({ equipo, rutaAgentes: rutas.agentes }) : null,
          codigo,
          // Las carpetas skills/ de los plugins, en solo lectura: las skills leen sus referencias.
          plugins: pluginsTurno,
          objetivo: conObjetivo,
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
          env: completo ? armarEntornoCompleto(cfg, codigo?.entorno ?? null) : armarEntorno(cfg, equipo ? topes : null, codigo?.entorno ?? null),
          cwd: rutas.cwd,
          prompt,
          perfil: perfilTurno,
          equipo,
          codigo,
          completo,
          vigia,
          timeoutMs: cfg.timeoutTurnoMs,
          maxRevisionesObjetivo: conObjetivo ? (cfg.objetivoMaxRevisiones ?? MAX_REVISIONES_OBJETIVO) : 0,
          alEvento: (evento, acc) => {
            // Cupo semanal y ventana de 5 h: vienen gratis en el stream del turno.
            if (evento?.type === 'rate_limit_event') {
              medidor?.registrarEvento(evento);
              return;
            }
            if (completo) for (const f of filasAuditoriaCompleto(evento)) auditarCompleto(idConversation, f, codigo);
            else if (codigo) auditarCodigo(idConversation, evento, codigo);
            if (acc.ultimoTexto) ultimoTexto = acc.ultimoTexto;
            for (const f of acc.archivosTocados ?? []) tocados.add(f);
            // La tablita de sub-agentes del chat: se actualiza cuando cambia
            // el conjunto de subagentes que están trabajando.
            if (vigia) {
              const activos = vigia.activos();
              const clave = activos.map((c) => c.toolUseId).join(',');
              if (clave !== ultimosActivos) {
                ultimosActivos = clave;
                const etiqueta = activos.length > 0 ? `Trabajando con ${activos.length === 1 ? '1 subagente' : `${activos.length} subagentes`}…` : 'Consolidando lo del equipo…';
                ultimaEtiqueta = etiqueta;
                indicador = { state: 'tool', label: etiqueta };
                void synerlink.estado(idConversation, 'tool', etiqueta, tareasIndicador(activos)).catch(() => null);
                return;
              }
              if (evento.parent_tool_use_id) return; // lo de adentro de un subagente no mueve la etiqueta
            }
            if (evento.type !== 'assistant' || !acc.ultimaHerramienta) return;
            const etiqueta = etiquetaHerramienta(acc.ultimaHerramienta);
            if (etiqueta === ultimaEtiqueta) return;
            ultimaEtiqueta = etiqueta;
            indicador = { state: 'tool', label: etiqueta };
            void synerlink.estado(idConversation, 'tool', etiqueta).catch(() => null);
          },
        });
      };

      await synerlink.estado(idConversation, 'thinking', 'Pensando…').catch(() => null);
      // Aviso intermedio en el hilo SIN apagar el indicador (synerlink.avisar deja state/label).
      const avisar = async (texto) => {
        if (!synerlink.avisar) return false;
        await synerlink.avisar(idConversation, codigo ? ocultarSecreto(texto, codigo.token) : texto, indicador.state, indicador.label);
        return true;
      };
      supervisor = crearSupervisor({
        intervaloAvisoMs: cfg.avisoProgresoMs ?? 0,
        alAviso: async (ms) => {
          const ok = await avisar(textoAvisoProgreso({ transcurridoMs: ms, topeMs: cfg.timeoutTurnoMs, actividad: indicador.label, ultimoTexto }));
          if (ok) log(`conversación ${idConversation}: aviso de progreso (${duracionLegible(ms)}).`);
        },
        alLatido: () => synerlink.estado(idConversation, indicador.state, indicador.label),
      });
      let sesion = estado.sesionDe(idConversation);
      // Un comando que mira la conversación (/compact, /context, /recap…) en un hilo sin conversación todavía.
      if (nativo && !nativo.objetivo && sesion.nueva && ['compact', 'context', 'recap', 'usage', 'cost'].includes(nativo.nombre)) {
        await supervisor.detener();
        await synerlink.responder(idConversation, `Este hilo todavía no tiene conversación con el asistente, así que \`/${nativo.nombre}\` todavía no tiene sobre qué trabajar. Escríbale primero lo que necesita.`);
        return;
      }
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

      // Turno cortado por tiempo: la sesión YA existe (arrancó: hubo init) y conserva el avance.
      // Se marca iniciada para que el siguiente turno («continúa») haga --resume y no abra otra.
      const cortadoPorTiempo = (x) => x.abortado === 'tiempo agotado' && Boolean(x.init);
      if (cortadoPorTiempo(r)) estado.marcarIniciada(idConversation, sesion.id);
      // /goal parado por revisiones: igual, la sesión existe y guarda el avance (y el objetivo).
      const paradoPorObjetivo = typeof r.abortado === 'string' && r.abortado.startsWith('objetivo sin cumplir') && Boolean(r.init);
      if (paradoPorObjetivo) estado.marcarIniciada(idConversation, sesion.id);
      // Continuación automática (HILOS_CONTINUAR_AL_AGOTAR=si): UNA vez, sobre la misma sesión.
      let continuacion = false;
      if (cortadoPorTiempo(r) && cfg.continuarAlAgotar) {
        continuacion = true;
        log(`conversación ${idConversation}: tiempo agotado; continuación automática (una vez).`);
        await avisar(
          `⏱️ Se cumplió el tiempo máximo de este turno (${duracionLegible(cfg.timeoutTurnoMs)}) y la tarea sigue en curso. Continúo automáticamente una vez más desde donde quedé; le aviso al terminar.`
        ).catch(() => null);
        sesion = estado.sesionDe(idConversation);
        r = await ejecutar(sesion, PROMPT_CONTINUACION);
        if (cortadoPorTiempo(r)) estado.marcarIniciada(idConversation, sesion.id);
      }
      // Fin del trabajo del modelo: se apagan los avisos y el latido, y se espera lo que esté en
      // vuelo (un latido tardío no debe volver a encender el indicador tras la respuesta).
      await supervisor.detener();
      const transcurridoMs = Date.now() - inicio.getTime();
      const archivosTurno = () =>
        archivosDelTurno({
          cwd: rutas.cwd,
          escaneados: archivosModificadosDesde(rutas.trabajo, inicio.getTime(), { base: rutas.cwd, excluir: [path.basename(rutas.propuestas)] }),
          tocados: [...tocados],
        });

      // El id de la sesión lo fija SIEMPRE el puente (--session-id); nunca se
      // adopta el que diga el proceso. Si no coinciden, algo raro pasó.
      if (r.resultado) estado.marcarIniciada(idConversation, sesion.id);
      if (r.sessionId && r.sessionId !== sesion.id) {
        log(`conversación ${idConversation}: el proceso reportó otra sesión (${r.sessionId}); se conserva ${sesion.id}.`);
      }

      let cuerpo;
      if (paradoPorObjetivo) {
        const o = estado.objetivoDe(idConversation);
        cuerpo =
          `${ultimoTexto ? `${ultimoTexto}\n\n` : ''}🎯 El objetivo (/goal) **sigue sin cumplirse** después de ${cfg.objetivoMaxRevisiones ?? MAX_REVISIONES_OBJETIVO} revisiones en este mensaje, así que paré aquí para no dar vueltas` +
          `${o ? `: «${o.condicion}»` : ''}. Sigue activo: en su próximo mensaje continúo hacia él (por ejemplo, si falta una confirmación o un dato, escríbalo). Para quitarlo: \`/goal clear\`.`;
        log(`conversación ${idConversation}: turno parado (${r.abortado}).`);
      } else if (r.abortado) {
        cuerpo = r.abortado.startsWith('arranque inseguro')
          ? 'No pude atender el mensaje: el proceso arrancó con permisos que este puente no admite y se detuvo por seguridad. Avísele a Tecnología.'
          : r.abortado.startsWith('subagente fuera')
            ? 'Detuve el trabajo por seguridad: un subagente intentó salirse de lo aprobado para el equipo del proyecto. Tecnología quedó con el registro; puede intentar de nuevo.'
            : textoCorte({ motivo: 'tiempo', transcurridoMs, topeMs: cfg.timeoutTurnoMs, ultimoTexto, archivos: archivosTurno(), continuacion });
        log(`conversación ${idConversation}: turno abortado (${r.abortado}) tras ${duracionLegible(transcurridoMs)}${continuacion ? ', también en la continuación automática' : ''}`);
      } else if (/budget/i.test(r.resultado?.subtipo ?? '')) {
        // Solo pasa si hay un tope configurado (con HILOS_MAX_BUDGET_USD=0/off no se pasa --max-budget-usd).
        cuerpo = textoCorte({ motivo: 'gasto', transcurridoMs, presupuestoUsd: equipo ? topes.presupuestoUsd : cfg.presupuestoUsd, ultimoTexto, archivos: archivosTurno() });
        log(`conversación ${idConversation}: tope de gasto alcanzado (${r.resultado.subtipo})`);
      } else if (!r.resultado?.ok) {
        // Con avance visible, el mismo mensaje útil del corte; sin avance, el de siempre.
        const archivos = archivosTurno();
        cuerpo =
          ultimoTexto || archivos.length > 0
            ? textoCorte({ motivo: 'error', transcurridoMs, ultimoTexto, archivos })
            : 'No pude completar la respuesta por un error del asistente. Intente de nuevo en unos minutos.';
        log(`conversación ${idConversation}: turno con error (código ${r.codigo}, ${r.resultado?.subtipo ?? 'sin resultado'})`);
      } else if (nativo?.objetivo?.quitar) {
        cuerpo = '🧹 Listo: quité el objetivo (/goal) de esta conversación.';
      } else {
        const sinTexto = nativo ? (ultimoTexto ? ultimoTexto : nativo.nombre === 'compact' ? '✅ Listo: compacté la memoria de este hilo; seguimos desde el resumen.' : `✅ \`/${nativo.nombre}\` listo.`) : '_(El asistente terminó sin texto.)_';
        cuerpo = r.resultado.texto.trim() || sinTexto;
      }
      // /goal: ¿el evaluador de Claude Code ya lo dio por cumplido? (adjunto goal_status de la transcripción)
      let notaObjetivo = '';
      if (objetivo && r.resultado && !r.abortado) {
        const est = estadoObjetivoSesion(rutaTranscripcion(cfg.configClaudeDir, rutas.cwd, sesion.id));
        if (est?.met) {
          estado.quitarObjetivo(idConversation);
          notaObjetivo = `\n\n✅ **Objetivo cumplido** (/goal): «${objetivo.condicion}». Ya no sigue activo.`;
          log(`conversación ${idConversation}: objetivo cumplido.`);
        } else if (est?.fallido) {
          estado.quitarObjetivo(idConversation);
          notaObjetivo = `\n\n⚠️ **Objetivo cerrado sin cumplir** (/goal): «${objetivo.condicion}». El evaluador concluyó que no se puede cumplir así${est.motivo ? `: ${String(est.motivo).slice(0, 400)}` : '.'} Si quiere, fije otro con \`/goal <condición>\`.`;
          log(`conversación ${idConversation}: objetivo imposible, se quita.`);
        } else if (nativo?.objetivo?.fijar) {
          notaObjetivo = `\n\n🎯 **Objetivo activo** (/goal): «${objetivo.condicion}». Sigue vigente en los próximos mensajes hasta que se cumpla; \`/goal clear\` lo quita.`;
        }
      }
      // Adjuntos salientes: líneas «MEDIA:trabajo/…» de la respuesta (adjuntos-salida.mjs).
      // Solo en un turno que terminó bien, y solo archivos de ./trabajo de ESTA conversación.
      let adjuntosSalida = [];
      if (r.resultado?.ok && !r.abortado) {
        // HTML → PDF (líneas «PDF:trabajo/….html» o «MEDIA:trabajo/….html»): cada una se cambia por
        // «MEDIA:trabajo/….pdf» y sigue el camino normal de los adjuntos. Chrome va en sandbox, sin red.
        try {
          const conv = await convertirMarcasPdf(cuerpo, {
            cwd: rutas.cwd,
            trabajo: rutas.trabajo,
            lecturas: [rutas.trabajo, rutas.adjuntos, rutas.contexto, rutas.archivos, ...recursos],
            chrome: chromePdf,
            timeoutMs: cfg.pdf?.timeoutMs,
            token: codigo?.token ?? null,
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
        const prep = await prepararAdjuntos(cuerpo, {
          cwd: rutas.cwd,
          trabajo: rutas.trabajo,
          excluir: [path.basename(rutas.propuestas)],
          log: (m) => log(`conversación ${idConversation}: ${m}`),
        });
        cuerpo = prep.texto;
        adjuntosSalida = prep.archivos;
        // Un archivo que lleve el token de GitHub del turno no sale del puente.
        if (codigo?.token) {
          const conToken = adjuntosSalida.filter((a) => a.datos.includes(codigo.token));
          if (conToken.length) {
            adjuntosSalida = adjuntosSalida.filter((a) => !conToken.includes(a));
            cuerpo += `\n\n⚠️ No adjunté ${conToken.map((a) => a.nombre).join(', ')}: contiene una credencial.`;
            log(`conversación ${idConversation}: adjunto(s) retenidos por contener el token: ${conToken.map((a) => a.nombre).join(', ')}.`);
          }
        }
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
      const avisoComando = comando?.accion === 'aviso' ? comando.texto : '';
      const notas = notaObjetivo + notaPropuestas;
      cuerpo = (avisoComando + aviso + avisoCompleto + avisoEquipo + avisoCodigo + avisoConectores + avisoAgente + cuerpo).slice(0, MAX_RESPUESTA - notas.length) + notas;
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

      // Cada adjunto queda ADEMÁS en los Archivos del proyecto. Nunca frena la respuesta: si falla,
      // la respuesta sale igual con su adjunto y lo dice en una línea (archivar-proyecto.mjs).
      if (archivador && adjuntosSalida.length > 0) {
        await synerlink.estado(idConversation, 'tool', 'Archivando en el proyecto…').catch(() => null);
        const notaArchivo = await archivador.archivar(idConversation, adjuntosSalida);
        if (notaArchivo) cuerpo = `${cuerpo.slice(0, Math.max(0, MAX_RESPUESTA - notaArchivo.length - 2))}\n\n${notaArchivo}`;
      }

      if (adjuntosSalida.length > 0 && synerlink.responderConArchivos) {
        try {
          await synerlink.responderConArchivos(idConversation, cuerpo, adjuntosSalida);
          log(`conversación ${idConversation}: respuesta con ${adjuntosSalida.length} adjunto(s): ${adjuntosSalida.map((a) => `${a.nombre} (${a.bytes} B)`).join(', ')}.`);
        } catch (e) {
          // La respuesta NO se pierde: sale sin los archivos y lo dice.
          log(`conversación ${idConversation}: no se pudieron subir los adjuntos, se publica sin ellos:`, e.message);
          await synerlink.responder(
            idConversation,
            `${cuerpo}\n\n⚠️ No pude subir ${adjuntosSalida.length === 1 ? 'el archivo' : 'los archivos'} (${adjuntosSalida.map((a) => a.nombre).join(', ')}) por un error al guardarlos. Intente de nuevo en unos minutos.`
          );
        }
      } else {
        await synerlink.responder(idConversation, cuerpo);
      }

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
      await supervisor?.detener().catch(() => null);
      try {
        borrarMcpCompleto(completo?.rutaMcp);
      } catch {}
      try {
        borrarMcpAgente(delAgente?.rutaMcp);
      } catch {}
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

/** Conectores del agente para la línea «listo:» (solo NOMBRES; nunca su configuración). */
export function conectoresAgenteListo(cfg) {
  if (!cfg.conectoresAgente?.configDir) return 'apagados';
  try {
    const a = servidoresAgente(cfg.conectoresAgente);
    return `${a.nombres.length ? a.nombres.join(', ') : 'ninguno'} (de ${cfg.conectoresAgente.configDir})${a.engramProyecto ? `; engram fijado a su memoria «${a.engramProyecto}»` : ''}${a.faltan.length ? `; variables sin valor: ${a.faltan.join(', ')}` : ''}`;
  } catch (e) {
    return `NO se pudieron leer (${e.message.slice(0, 120)}): los turnos irán sin ellos`;
  }
}

/** Estado de los conectores de PRUEBAS para la línea «listo:» (sin valores secretos). */
export function pruebasListo(cfg, verificar = verificarSecretosPruebas) {
  if (!cfg.pruebasKronos?.habilitado) return 'apagado';
  try {
    verificar(cfg.conectoresSecretos);
    return `kronos-pruebas-sql + synerlink-testing-web (${cfg.pruebasKronos.base})`;
  } catch (e) {
    return `SIN credenciales (${e.message})`;
  }
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
  // Medidor del consumo de Anthropic (cuota.mjs): sin turnos en curso, consulta mínima cada intervalo.
  let ocupado = () => false;
  const medidor = cfg.cuota?.habilitada
    ? crearMedidorCuota({ credencial: cfg.credencial, publicar: (e) => synerlink.cuota(e), ocupado: () => ocupado(), intervaloMs: cfg.cuota.intervaloMs, log })
    : null;
  const puente = crearPuente({ cfg, synerlink, estado, medidor });
  ocupado = () => puente.enProceso.size > 0;
  medidor?.iniciar();
  log(medidor ? `medidor de consumo: stream de cada turno${cfg.cuota.intervaloMs > 0 && cfg.credencial.tipo === 'oauth-token' ? ` + consulta mínima cada ${Math.round(cfg.cuota.intervaloMs / 1000)} s sin turnos` : ''}.` : 'medidor de consumo apagado (HILOS_CUOTA=no).');
  log(`listo: agente ${cfg.agente} (${cfg.agenteNombre}), entorno ${cfg.entorno}, tope ${cfg.maxConcurrencia} hilos, credencial: ${cfg.origenCredencial}, modelo del hilo principal: ${cfg.modelo ?? 'el predeterminado de la cuenta (sin HILOS_MODELO)'}; tope por turno ${duracionLegible(cfg.timeoutTurnoMs)}; gasto ${cfg.sinTopeGasto ? 'SIN TOPE' : cfg.presupuestoUsd ? `tope ${cfg.presupuestoUsd} USD` : `sin tope general (equipo ${cfg.subagentesPresupuestoUsd} USD)`}; avisos de progreso ${cfg.avisoProgresoMs ? `cada ${duracionLegible(cfg.avisoProgresoMs)}` : 'apagados'}; continuación automática ${cfg.continuarAlAgotar ? 'sí' : 'no'}; PRUEBAS para todos los hilos: ${pruebasListo(cfg)}; conectores del agente: ${conectoresAgenteListo(cfg)}.`);

  let parar = false;
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.on(senal, () => {
      log(`recibí ${senal}: termino los turnos en curso y salgo.`);
      parar = true;
      medidor?.detener();
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
