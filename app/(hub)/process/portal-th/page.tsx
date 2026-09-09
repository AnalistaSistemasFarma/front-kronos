'use client';

import PortalContenido, { usePortalContenido } from '../../../../components/portal/PortalContenido';

/**
 * PORTAL DE TALENTO HUMANO — el MÓDULO dentro del hub.
 *
 * Es el mismo contenido del portal abierto, pero para quien ya tiene usuario
 * en SynerLink: entra con su sesión de siempre y **no necesita ningún código**.
 * El permiso se asigna desde Administración → Usuarios como cualquier otro
 * módulo (subproceso `/process/portal-th`), que es como se pidió.
 *
 * El contenido se pinta con el MISMO componente que la página abierta, para
 * que un arreglo en uno no se quede sin hacer en el otro.
 */
export default function PortalTalentoHumanoModulo() {
  const { cargando, email, error, documentos, banners } = usePortalContenido();

  return (
    <div className='app-page-shell app-page-shell--fill min-h-screen'>
      <div className='portal-th portal-th--modulo'>
        <div className='portal-th__cuerpo'>
          <header className='portal-th__encabezado-modulo'>
            <h1>Portal de Talento Humano</h1>
            <p>Políticas, reglamentos y anuncios de Talento Humano.</p>
          </header>

          {cargando && <p className='portal-th__estado'>Cargando…</p>}

          {/* Sin sesión válida aquí significa que el módulo NO está asignado:
              la sesión de SynerLink existe, pero le falta el permiso. Se dice
              tal cual, y a dónde ir — no un "no autorizado" que deja a la
              persona sin saber qué hacer. */}
          {!cargando && !email && (
            <p className='portal-th__estado'>
              No tiene habilitado este módulo. Solicítelo a la administración de SynerLink.
            </p>
          )}

          {!cargando && email && <PortalContenido documentos={documentos} banners={banners} />}
          {!cargando && error && <p className='portal-th__error'>{error}</p>}
        </div>
      </div>
    </div>
  );
}
