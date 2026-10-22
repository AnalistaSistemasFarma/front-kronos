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
 *   POST /api/chat/agent/messages         publicar la respuesta (JSON, o multipart con adjuntos) y los
 *                                         avisos de progreso (con el indicador aún «trabajando»)
 *   POST /api/chat/agent/projects/proposals  entregar las PROPUESTAS de tareas del turno
 *   POST /api/chat/agent/usage            consumo (tokens) del turno
 *   POST /api/chat/agent/quota            cupo semanal y ventana de 5 h del token (cuota.mjs)
 *   POST /api/chat/agent/projects/team/requests     pedidos de «Sugerir equipo» (los reclama)
 *   POST /api/chat/agent/projects/team/suggestions  entrega de una sugerencia
 *   POST /api/chat/agent/projects/team/runs         lo que hizo cada subagente en un turno
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
    /**
     * Mensaje INTERMEDIO (aviso de progreso, 2026-10-22): se publica en el hilo pero el
     * indicador queda como estaba («trabajando»), no en reposo. La ruta acepta state/label
     * y no toca la tablita de subagentes (`tasks`).
     */
    avisar: (idConversation, body, state = 'thinking', label = null) =>
      json('/api/chat/agent/messages', { method: 'POST', body: { idConversation, body, state: state === 'tool' ? 'tool' : 'thinking', label } }),
    /**
     * Publica la respuesta CON adjuntos: misma ruta, en multipart/form-data
     * (campos idConversation, body, state y un `files` por archivo). `archivos`
     * ya viene validado y leído por adjuntos-salida.mjs ({ nombre, datos, tipo }).
     */
    async responderConArchivos(idConversation, body, archivos) {
      const form = new FormData();
      form.append('idConversation', String(idConversation));
      form.append('body', body ?? '');
      form.append('state', 'idle');
      for (const a of archivos) form.append('files', new Blob([a.datos], { type: a.tipo }), a.nombre);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 180_000);
      try {
        // Sin Content-Type: fetch pone el multipart con su boundary.
        const res = await fetchImpl(`${url}/api/chat/agent/messages`, { method: 'POST', headers: cabeceras, body: form, signal: ctrl.signal });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new ErrorSynerLink(`POST /api/chat/agent/messages (adjuntos) -> HTTP ${res.status}${data?.error ? ` (${data.error})` : ''}`, res.status);
        }
        return data;
      } finally {
        clearTimeout(t);
      }
    },
    /** Propuestas de tareas del turno: quedan PENDIENTES hasta que un dueño o editor las confirme. */
    proponer: (idConversation, items) => json('/api/chat/agent/projects/proposals', { method: 'POST', body: { idConversation, items } }),
    consumo: (reporte) => json('/api/chat/agent/usage', { method: 'POST', body: reporte }),
    /** Cupo semanal y ventana de 5 h del token del agente (cuota.mjs). */
    cuota: (estado) => json('/api/chat/agent/quota', { method: 'POST', body: estado, timeoutMs: 20_000 }),
    // Equipo de subagentes (F2, 2026-10-18).
    /** Reclama los pedidos de «Sugerir equipo» pendientes de los proyectos de este agente. */
    pedidosEquipo: () => json('/api/chat/agent/projects/team/requests', { method: 'POST', body: {} }),
    /** Entrega la sugerencia (o el error) de un pedido. Quedan PROPUESTOS: el dueño aprueba. */
    entregarSugerencia: (idRequest, cuerpo) =>
      json('/api/chat/agent/projects/team/suggestions', { method: 'POST', body: { idRequest, ...cuerpo } }),
    /** Registra lo que hizo cada subagente en un turno (para la sección Equipo y el consumo). */
    corridas: (reporte) => json('/api/chat/agent/projects/team/runs', { method: 'POST', body: reporte }),
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
