/**
 * ARCHIVAR EN EL PROYECTO lo que el hilo adjunta (2026-10-23).
 *
 * Requisito de Nicolás Rivera (2026-10-23 14:12 COT): «todos los documentos que
 * genere desde el chat de un proyecto deben archivarse en los Archivos del
 * proyecto». Vale para todos los agentes, usuarios y proyectos.
 *
 * Cada archivo que sale con la respuesta (líneas `MEDIA:` o el PDF de `PDF:`,
 * ya validados por adjuntos-salida.mjs) se sube ADEMÁS a la pestaña Archivos con
 * POST /api/chat/agent/projects/files (llave del puente; el modelo nunca la ve).
 *
 * NUNCA bloquea la respuesta: si falla, la respuesta sale igual con su adjunto
 * y se avisa en UNA línea.
 *
 * Ruta ausente (404 SIN cuerpo JSON de la API: el SynerLink de ese entorno aún
 * no trae la ruta): reintento con una pausa corta y, si sigue igual, no se
 * vuelve a intentar durante PAUSA_404_MS (igual que el medidor de cuota). Un 404
 * CON error de la API («Conversación no encontrada») es otra cosa y no pausa.
 */

/** Pausa corta antes del único reintento tras un 404 de ruta ausente. */
export const PAUSA_REINTENTO_MS = 3_000;
/** Si la ruta sigue sin existir, no se insiste hasta pasado este tiempo. */
export const PAUSA_404_MS = 5 * 60 * 1000;

const lista = (nombres) => nombres.join(', ');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ synerlink: { archivarEnProyecto?: Function }, log?: (m: string) => void,
 *           ahora?: () => number, dormir?: (ms: number) => Promise<void>,
 *           pausaReintentoMs?: number, pausa404Ms?: number }} o
 */
export function crearArchivador({ synerlink, log = () => {}, ahora = Date.now, dormir = espera, pausaReintentoMs = PAUSA_REINTENTO_MS, pausa404Ms = PAUSA_404_MS }) {
  let pausaHasta = 0;
  let avisado = false;

  const rutaAusente = (e) => e?.status === 404 && e?.rutaAusente === true;

  /**
   * Sube `archivos` ({ nombre, datos, tipo }) a los Archivos del proyecto de la conversación.
   * Nunca lanza. Devuelve la nota (una línea) para la respuesta; '' si no hay nada que decir.
   */
  async function archivar(idConversation, archivos) {
    if (!archivos?.length || typeof synerlink?.archivarEnProyecto !== 'function') return '';
    const nombres = archivos.map((a) => a.nombre);
    const sinArchivar = (motivo) =>
      `⚠️ ${archivos.length === 1 ? 'El archivo' : 'Los archivos'} (${lista(nombres)}) ${archivos.length === 1 ? 'salió' : 'salieron'} con la respuesta, pero no ${archivos.length === 1 ? 'quedó archivado' : 'quedaron archivados'} en los Archivos del proyecto: ${motivo}.`;

    if (ahora() < pausaHasta) return sinArchivar('esa función aún no está disponible en este entorno');

    let r = null;
    let error = null;
    for (let intento = 1; intento <= 2; intento++) {
      try {
        r = await synerlink.archivarEnProyecto(idConversation, archivos);
        error = null;
        break;
      } catch (e) {
        error = e;
        if (!rutaAusente(e) || intento === 2) break;
        await dormir(pausaReintentoMs);
      }
    }

    if (error) {
      if (rutaAusente(error)) {
        pausaHasta = ahora() + pausa404Ms;
        if (!avisado) log(`SynerLink no trae /api/chat/agent/projects/files (404): los adjuntos no se archivan en el proyecto; reintento cada ${Math.round(pausa404Ms / 60000)} min.`);
        avisado = true;
        return sinArchivar('esa función aún no está disponible en este entorno');
      }
      log(`conversación ${idConversation}: no se pudieron archivar en el proyecto (${lista(nombres)}):`, error?.message ?? error);
      // 409 (proyecto lleno) y 400 traen un motivo claro de la API; lo demás, genérico.
      const motivo = [400, 409].includes(error?.status) && error?.detalle ? String(error.detalle).replace(/\.$/, '') : 'error al guardarlos; puede cargarlos a mano en la pestaña Archivos';
      return sinArchivar(motivo);
    }

    if (avisado) {
      log('SynerLink ya trae /api/chat/agent/projects/files: los adjuntos se archivan en el proyecto.');
      avisado = false;
    }
    const archivados = Array.isArray(r?.archived) ? r.archived : [];
    log(`conversación ${idConversation}: ${archivados.length || archivos.length} archivo(s) archivado(s) en el proyecto.`);
    const renombrados = archivados.filter((a) => a?.renamed && a.fileName);
    const detalle = renombrados.length ? ` (${renombrados.map((a) => `${a.originalName} como «${a.fileName}», porque ya había uno con ese nombre`).join('; ')})` : '';
    return `📁 ${archivos.length === 1 ? 'Quedó archivado' : 'Quedaron archivados'} en los Archivos del proyecto${detalle}.`;
  }

  return { archivar };
}

/** Línea del encabezado del turno (textoSistema → bloqueArchivar). */
export function textoArchivarProyecto() {
  return '- ARCHIVOS DEL PROYECTO: todo lo que adjunte a su respuesta (líneas `MEDIA:` o el PDF de `PDF:`) queda ADEMÁS archivado en la pestaña Archivos del proyecto, como «subido por usted en esta conversación», a la vista de los miembros y como base de conocimiento de las demás conversaciones. Si ya hay un archivo con el mismo nombre, el nuevo se guarda como «nombre (2)»; nada se sobrescribe. Use nombres claros (por ejemplo informe-ventas-2026-10.pdf). No copie archivos a la carpeta de archivos del proyecto: es un espejo de solo lectura y no publica nada.';
}
