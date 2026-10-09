'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PortalFormacion from '../../../components/portal/PortalFormacion';
import { RUTA_FORMACION_HUB, origenDesdeParametro, urlVolverAlPortal } from '../../../lib/portal/formacion-navegacion';

/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN, en su propia página.
 *
 * Pedido de Cristian Baldión (2026-09-30): Formación ya no va al final del
 * portal; se abre en una pestaña nueva desde el acceso "Formación" del portal
 * principal. Aquí vive todo: lista de cursos, vista del estudiante y vista del
 * formador (el "← Volver a Formación" de un curso sigue funcionando igual,
 * porque es estado interno de `PortalFormacion`).
 *
 * Funciona con las DOS sesiones, igual que el portal: la del código al correo
 * y la de SynerLink — las rutas `/api/portal/*` resuelven quién es (ver
 * `lib/portal/acceso.ts`). Vive fuera de `(hub)` por la misma razón que
 * `/portal`: adentro quedaría detrás del login de SynerLink.
 */
function PaginaFormacion() {
  const origen = origenDesdeParametro(useSearchParams().get('desde'));
  const volver = urlVolverAlPortal(origen);
  const [sinSesion, setSinSesion] = useState(false);
  const router = useRouter();

  // Enlaces viejos (`?desde=hub`): quien viene del módulo del hub sigue en el
  // hub, con el encabezado de SynerLink (Nicolás, 2026-10-09).
  useEffect(() => {
    if (origen === 'hub') router.replace(RUTA_FORMACION_HUB);
  }, [origen, router]);

  return (
    <div className='portal-th portal-th--formacion'>
      <header className='portal-th__barra'>
        <div className='portal-th__marca'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className='portal-th__logo' src='/portal-th/logo-gss.png' alt='Group Shared Services Latinoamérica' />
          <div>
            <h1>Formación</h1>
            <p>Portal de Talento Humano · Group Shared Services Latinoamérica</p>
          </div>
        </div>
      </header>

      <main className='portal-th__cuerpo'>
        <a className='portal-th__volver portal-th__volver-portal' href={volver}>
          ← Volver al portal
        </a>

        {sinSesion ? (
          <section className='portal-th__ingreso'>
            <h2>Ingrese primero al portal</h2>
            <p>
              Para ver los cursos de Formación, ingrese al Portal de Talento Humano y vuelva a abrir Formación desde
              allí.
            </p>
            <a className='portal-th__certificado-boton' href={volver}>
              Ir al portal
            </a>
          </section>
        ) : (
          <section className='portal-th__seccion'>
            <PortalFormacion onSinSesion={() => setSinSesion(true)} />
          </section>
        )}
      </main>

      <footer className='portal-th__pie'>Group Shared Services Latinoamérica · Talento Humano</footer>
    </div>
  );
}

export default function PaginaFormacionConParametros() {
  // `useSearchParams` exige un límite de Suspense en el build de Next 15.
  return (
    <Suspense fallback={<p className='portal-th__estado'>Cargando…</p>}>
      <PaginaFormacion />
    </Suspense>
  );
}
