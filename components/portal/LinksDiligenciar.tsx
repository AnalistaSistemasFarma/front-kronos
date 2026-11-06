'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { LINKS_DILIGENCIAR, RUTA_PAGINA_FORMULARIOS_SST, TITULO_LINKS_DILIGENCIAR, rutaApiFormularioSst, type LinkDiligenciar } from '../../lib/portal/links-diligenciar';
import estilos from './LinksDiligenciar.module.css';

/**
 * «LINKS PARA DILIGENCIAR EN CASO DE SER REQUERIDO» (Cristian Baldión, 2026-10-20): bajo la tarjeta «Formación» de la página principal,
 * con el mismo estilo de título que «Políticas y reglamentos», dos botones —B1 y B2— que abren en una ventana los formularios propios
 * de Seguridad y Salud en el Trabajo. Se pintan siempre (su texto no depende de ninguna API); el formulario se pide al pulsar.
 *
 * Quien además puede ver las respuestas (administrador y lectores SST; lo dice el servidor) ve un acceso a la página con la tabla y el
 * Excel. La ventana del formulario es la de Formación (`VisorFormulario`), cargada solo cuando se pulsa un botón.
 */

const VisorFormulario = dynamic(() => import('./FormularioPropio').then((m) => m.VisorFormulario), { ssr: false });

export default function LinksDiligenciar() {
  const [abierto, setAbierto] = useState<LinkDiligenciar | null>(null);
  const [puedeVerRespuestas, setPuedeVerRespuestas] = useState(false);
  const cerrar = useCallback(() => setAbierto(null), []);

  // El acceso a las respuestas es un atajo: si la consulta falla, simplemente no aparece (el servidor exige el permiso en cada ruta).
  useEffect(() => {
    const control = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/portal/formularios-sst', { cache: 'no-store', signal: control.signal });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { puedeVerRespuestas?: unknown };
        if (!control.signal.aborted) setPuedeVerRespuestas(data.puedeVerRespuestas === true);
      } catch {
        // sin acceso directo a las respuestas
      }
    })();
    return () => control.abort();
  }, []);

  return (
    <section id='portal-th-links-diligenciar' className='portal-th__seccion' data-testid='links-diligenciar'>
      <div className='portal-th__seccion-barra'>
        <h2>{TITULO_LINKS_DILIGENCIAR}</h2>
      </div>
      <div className={estilos.botones}>
        {LINKS_DILIGENCIAR.map((l) => (
          <button key={l.codigo} type='button' className={estilos.boton} onClick={() => setAbierto(l)} data-testid={`link-diligenciar-${l.codigo}`}>
            {l.texto}
          </button>
        ))}
      </div>
      {puedeVerRespuestas && (
        <a className={estilos.respuestas} href={RUTA_PAGINA_FORMULARIOS_SST} data-testid='ver-respuestas-formularios-sst'>
          Ver las respuestas de estos formularios →
        </a>
      )}
      {abierto && <VisorFormulario rutaApi={rutaApiFormularioSst(abierto.codigo)} titulo={abierto.texto} onCerrar={cerrar} />}
    </section>
  );
}
