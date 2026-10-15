'use client';

import { useState } from 'react';
import PortalFormacion from '../../../../../components/portal/PortalFormacion';

/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN como parte del MÓDULO del hub.
 *
 * Observación de Nicolás (2026-10-09): Formación abierta desde el módulo
 * `/process/portal-th` caía en `/portal/formacion` (la página ABIERTA, fuera de
 * `(hub)`), sin el encabezado ni el menú de SynerLink, y no parecía uno de
 * nuestros módulos. Quien entra con su sesión de SynerLink ahora ve Formación
 * aquí, dentro del layout del hub (Header + AppHubShell), con el mismo
 * encabezado de módulo que el Portal de Talento Humano.
 *
 * `/portal/formacion` sigue existiendo para quienes NO tienen usuario de
 * SynerLink (sesión por código al correo). El contenido es el MISMO componente
 * (`PortalFormacion`) en las dos, para que un arreglo no se quede a medias.
 */
export default function FormacionModulo() {
  const [sinSesion, setSinSesion] = useState(false);

  return (
    <div className='app-page-shell app-page-shell--fill min-h-screen'>
      <div className='portal-th portal-th--modulo'>
        <div className='portal-th__cuerpo portal-th__cuerpo--ancho'>
          <header className='portal-th__encabezado-modulo'>
            <h1>Formación</h1>
            <p>Cursos, materiales, progreso y certificados del Portal de Talento Humano.</p>
          </header>

          <a className='portal-th__volver portal-th__volver-portal' href='/process/portal-th'>
            ← Volver al Portal de Talento Humano
          </a>

          {sinSesion ? (
            <p className='portal-th__estado'>
              No tiene habilitado este módulo. Solicítelo a la administración de SynerLink.
            </p>
          ) : (
            <section className='portal-th__seccion'>
              <PortalFormacion onSinSesion={() => setSinSesion(true)} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
