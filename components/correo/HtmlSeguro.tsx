'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Cuerpo del correo YA SANEADO en el servidor, mostrado además dentro de un
 * iframe con `sandbox` SIN `allow-scripts` (nada puede ejecutarse) y una CSP
 * propia: sin red salvo imágenes incrustadas (data:) y, solo si la persona lo
 * pidió, imágenes https. Los enlaces abren en otra pestaña.
 */
export default function HtmlSeguro({ html, remotas, titulo }: { html: string; remotas: boolean; titulo: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [alto, setAlto] = useState(120);

  const doc = useMemo(() => {
    const img = remotas ? 'data: https:' : 'data:';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${img}; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer"><base target="_blank">
<style>
html,body{margin:0;padding:0;background:#fff;color:#1f2933;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{vertical-align:top}
blockquote{margin:0 0 0 4px;padding-left:10px;border-left:3px solid #cbd2d9;color:#52606d}
a{color:#1c64f2}pre{white-space:pre-wrap}
</style></head><body>${html}</body></html>`;
  }, [html, remotas]);

  const medir = useCallback(() => {
    try {
      const h = ref.current?.contentDocument?.documentElement?.scrollHeight;
      if (h) setAlto(Math.min(Math.max(h + 8, 60), 4000));
    } catch {
      /* sin acceso al documento: se queda con el alto por defecto */
    }
  }, []);

  return (
    <iframe
      ref={ref}
      title={titulo}
      srcDoc={doc}
      onLoad={medir}
      // allow-same-origin solo para medir el alto; sin allow-scripts nada se ejecuta.
      sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
      referrerPolicy='no-referrer'
      style={{ width: '100%', height: alto, border: 0, borderRadius: 8, background: '#fff' }}
      data-testid='correo-cuerpo'
    />
  );
}
