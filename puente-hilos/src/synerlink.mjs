/**
 * Cliente de la API del AGENTE de SynerLink, con la llave de scope "projects".
 *
 * Solo habla con las rutas que esa llave puede usar (todas ancladas al
 * agente de la llave y a conversaciones de PROYECTO en el servidor):
 *   GET  /api/chat/agent/inbox            bandeja de proyectos (long-poll)
 *   POST /api/chat/agent/ack              confirmar lo atendido
 *   GET  /api/chat/agent/projects/context instrucciones, perfil y archivos
 *   GET  /api/chat/agent/projects/files/N descarga de un archivo del proyecto
 *   GET  /api/chat/attachments/N          descarga de un adjunto del hilo
 *   POST /api/chat/agent/status           indicador «trabajando»
 *   POST /api/chat/agent/messages         publicar la respuesta
 *   POST /api/chat/agent/projects/proposals  entregar las PROPUESTAS de tareas del turno
 *   POST /api/chat/agent/usage            consumo (tokens) del turno
 *
 * La llave nunca se escribe en registros ni pasa al proceso del modelo.
 */
export class ErrorSynerLink extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.status = status;
  }
}

export function crearClienteSynerLink({ url, llave, fetchImpl = globalThis.fetch }) {
  const cabeceras = { Authorization: `Bearer ${llave}` };

  async function pedir(ruta, { method = 'GET', body, timeoutMs = 60_000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${url}${ruta}`, {
        method,
        headers: body !== undefined ? { ...cabeceras, 'Content-Type': 'application/json' } : cabeceras,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async function json(ruta, opciones) {
    const res = await pedir(ruta, opciones);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ErrorSynerLink(`${opciones?.method ?? 'GET'} ${ruta.split('?')[0]} -> HTTP ${res.status}${data?.error ? ` (${data.error})` : ''}`, res.status);
    }
    return data;
  }

  return {
    /** Long-poll de la bandeja de proyectos. `ack=false`: se confirma al terminar el turno. */
    bandeja: (waitSeconds = 25) =>
      json(`/api/chat/agent/inbox?wait=${waitSeconds}&limit=20&ack=false`, { timeoutMs: (waitSeconds + 15) * 1000 }),
    confirmar: (messageIds) => json('/api/chat/agent/ack', { method: 'POST', body: { messageIds } }),
    contexto: (idConversation) =>
      json(`/api/chat/agent/projects/context?idConversation=${encodeURIComponent(idConversation)}`),
    estado: (idConversation, state, label, tasks) =>
      json('/api/chat/agent/status', {
        method: 'POST',
        body: { idConversation, state, label, ...(tasks !== undefined ? { tasks } : {}) },
      }),
    responder: (idConversation, body) =>
      json('/api/chat/agent/messages', { method: 'POST', body: { idConversation, body, state: 'idle' } }),
    /** Propuestas de tareas del turno: quedan PENDIENTES hasta que un dueño o editor las confirme. */
    proponer: (idConversation, items) => json('/api/chat/agent/projects/proposals', { method: 'POST', body: { idConversation, items } }),
    consumo: (reporte) => json('/api/chat/agent/usage', { method: 'POST', body: reporte }),
    /** Descarga binaria (archivo del proyecto o adjunto). Devuelve un Buffer. */
    async descargar(ruta, maxBytes = 25 * 1024 * 1024) {
      const res = await pedir(ruta, { timeoutMs: 120_000 });
      if (!res.ok) throw new ErrorSynerLink(`GET ${ruta} -> HTTP ${res.status}`, res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new ErrorSynerLink(`GET ${ruta}: archivo demasiado grande`, 413);
      return buf;
    },
  };
}
