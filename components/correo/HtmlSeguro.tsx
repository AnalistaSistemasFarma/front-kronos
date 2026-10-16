'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classes from './correo.module.css';

/**
 * Cuerpo del correo YA SANEADO en el servidor, mostrado además dentro de un
 * iframe con `sandbox` SIN `allow-scripts` (nada puede ejecutarse) y una CSP
 * propia: sin red salvo imágenes incrustadas (data:) y, solo si la persona lo
 * pidió, imágenes https. Los enlaces abren en otra pestaña.
 */
export default function HtmlSeguro({ html, remotas, titulo }: { html: string; remotas: boolean; titulo: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [alto, setAlto] = useState(120);
  const contenido = useRef<ResizeObserver | null>(null);
  useEffect(() => () => contenido.current?.disconnect(), []);

  const doc = useMemo(() => {
    const img = remotas ? 'data: https:' : 'data:';
    // Superficie SIEMPRE blanca y esquema claro (como Gmail): en modo oscuro no se invierten los colores
    // del correo. `.correo-raiz` desplaza en horizontal las tablas más anchas que la pantalla (celular).
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${img}; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><base target="_blank">
<style>
:root{color-scheme:light}
html,body{margin:0;padding:0;background:#fff;color:#1f2933;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;overflow-wrap:break-word}
.correo-raiz{overflow-x:auto;overflow-y:hidden;max-width:100%}
img{max-width:100%;height:auto}
blockquote{margin:0 0 0 4px;padding-left:10px;border-left:3px solid #cbd2d9;color:#52606d}
a{color:#1c64f2}pre{white-space:pre-wrap}
body{display:flow-root}
</style></head><body><div class="correo-raiz">${html}</div></body></html>`;
  }, [html, remotas]);

  const medir = useCallback(() => {
    try {
      // body (no documentElement): el de documentElement nunca baja del alto actual del iframe y no encogería al ensancharse.
      const d = ref.current?.contentDocument;
      const h = d?.body?.scrollHeight || d?.documentElement?.scrollHeight;
      if (h) setAlto(Math.min(Math.max(h + 8, 60), 20000));
    } catch {
      /* sin acceso al documento: se queda con el alto por defecto */
    }
  }, []);

  // Al cargar: mide, y vuelve a medir cuando el contenido cambia de alto (imágenes que terminan de
  // cargar, fuentes). El observador vive en ESTA página: dentro del iframe no corre ningún script.
  const alCargar = useCallback(() => {
    medir();
    const d = ref.current?.contentDocument;
    if (!d?.body) return;
    d.querySelectorAll('img').forEach((i) => i.addEventListener('load', medir, { once: true }));
    if (typeof ResizeObserver === 'undefined') return;
    contenido.current?.disconnect();
    contenido.current = new ResizeObserver(() => medir());
    contenido.current.observe(d.body);
  }, [medir]);

  // El hilo ahora usa todo el ancho: al cambiar el ancho (ventana, barra lateral) el texto se reacomoda y cambia el alto.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let ancho = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === ancho) return;
      ancho = el.clientWidth;
      medir();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir]);

  return (
    <iframe
      ref={ref}
      title={titulo}
      srcDoc={doc}
      onLoad={alCargar}
      // allow-same-origin solo para medir el alto; sin allow-scripts nada se ejecuta.
      sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
      referrerPolicy='no-referrer'
      className={classes.cuerpoHtml}
      style={{ width: '100%', height: alto, border: 0, borderRadius: 8, background: '#fff', colorScheme: 'light', display: 'block' }}
      data-testid='correo-cuerpo'
    />
  );
}
