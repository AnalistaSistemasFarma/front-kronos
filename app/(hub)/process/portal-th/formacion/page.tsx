'use client';

import { useState } from 'react';
import PortalFormacion from '../../../../../components/portal/PortalFormacion';
import { urlVolverAlPortal } from '../../../../../lib/portal/formacion-navegacion';

/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN, como MÓDULO del hub.
 *
 * Lineamiento de SynerLink (Nicolás Rivera, 2026-10-09): toda pantalla que use
 * alguien con sesión de SynerLink va dentro del layout del hub —header, barra
 * lateral y menú—, para que no "parezca uno de nuestros módulos más". Antes,
 * el acceso "Formación" del módulo `/process/portal-th` abría
 * `/portal/formacion?desde=hub`, una página con barra propia y sin el header.
 *
 * El contenido es el MISMO componente (`PortalFormacion`) que usa la página
 * abierta `/portal/formacion`, que sigue existiendo para quien entra con el
 * código al correo (sin usuario de SynerLink) y por eso NO va detrás del login
 * del hub. Las rutas `/api/portal/*` no cambian: resuelven la sesión de
 * SynerLink y exigen el subproceso `/process/portal-th` (ver
 * `lib/portal/acceso.ts`).
 */
export default function FormacionModulo() {
  const [sinSesion, setSinSesion] = useState(false);

  return (
    <div className='app-page-shell app-page-shell--fill min-h-screen'>
      <div className='portal-th portal-th--modulo'>
        <div className='portal-th__cuerpo portal-th__cuerpo--ancho'>
          <a className='portal-th__volver portal-th__volver-portal' href={urlVolverAlPortal('hub')}>
            ← Volver al Portal de Talento Humano
          </a>
          <header className='portal-th__encabezado-modulo'>
            <h1>Formación</h1>
            <p>Cursos, materiales y evaluaciones del Portal de Talento Humano.</p>
          </header>

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
