'use client';

import { useState } from 'react';
import FormulariosSst from '../../../components/portal/FormulariosSst';

/**
 * PORTAL DE TALENTO HUMANO — FORMULARIOS SST, en su propia página (Cristian Baldión, 2026-10-20).
 *
 * Aquí se abren y se envían los formularios de Seguridad y Salud en el Trabajo, y quienes tienen permiso (administrador y lectores SST)
 * ven las respuestas y las exportan a Excel. Los botones de la página principal del portal llevarán a esta misma pantalla.
 *
 * Funciona con las DOS sesiones, igual que el portal: la del código al correo y la de SynerLink (las rutas `/api/portal/*` resuelven
 * quién es). Vive fuera de `(hub)` por la misma razón que `/portal`: adentro quedaría detrás del login de SynerLink.
 */
export default function PaginaFormulariosSst() {
  const [sinSesion, setSinSesion] = useState(false);
  return (
    <div className='portal-th portal-th--formacion'>
      <header className='portal-th__barra'>
        <div className='portal-th__marca'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className='portal-th__logo' src='/portal-th/logo-gss.png' alt='Group Shared Services Latinoamérica' />
          <div>
            <h1>Formularios SST</h1>
            <p>Portal de Talento Humano · Group Shared Services Latinoamérica</p>
          </div>
        </div>
      </header>

      <main className='portal-th__cuerpo'>
        <a className='portal-th__volver portal-th__volver-portal' href='/portal'>
          ← Volver al portal
        </a>
        {sinSesion ? (
          <section className='portal-th__ingreso'>
            <h2>Ingrese primero al portal</h2>
            <p>Para abrir los formularios de Seguridad y Salud en el Trabajo, ingrese al Portal de Talento Humano con su correo y vuelva a abrirlos desde allí.</p>
            <a className='portal-th__certificado-boton' href='/portal' data-testid='ingresar-sst'>
              Ir al portal
            </a>
          </section>
        ) : (
          <section className='portal-th__seccion'>
            <FormulariosSst onSinSesion={() => setSinSesion(true)} />
          </section>
        )}
      </main>

      <footer className='portal-th__pie'>Group Shared Services Latinoamérica · Talento Humano</footer>
    </div>
  );
}
