'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Center, Group, Loader, Modal, SegmentedControl, Stack, Table, Tabs, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFile,
  IconRefresh,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
} from '@tabler/icons-react';
import { formatBytes, urlImagenEnLinea } from '../../lib/chat/attachments';
import {
  lenguajeDe,
  parsearCsv,
  resaltar,
  separadorCsv,
  tipoDeVisor,
  urlVistaAdjunto,
  type TipoVisor,
} from '../../lib/chat/visor';
import ChatMarkdown from './ChatMarkdown';

/** Lo mínimo de un adjunto para abrirlo en el visor. */
export interface AdjuntoVisor {
  id: number;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_PASO = 0.5;
/** Escala base del PDF (la misma del visor seguro del SGC). */
const PDF_ESCALA_BASE = 1.3;

function mensajeDeError(status: number, cuerpo: { error?: string } | null): string {
  if (status === 404) return 'El archivo ya no está disponible o usted no tiene acceso a esta conversación.';
  if (status === 401) return 'Su sesión venció. Recargue la página e intente de nuevo.';
  if (status === 415) return 'Este tipo de archivo no tiene vista previa.';
  return cuerpo?.error || 'No se pudo preparar la vista previa de este archivo.';
}

async function pedir(url: string, signal: AbortSignal): Promise<Response> {
  const res = await fetch(url, { credentials: 'same-origin', signal });
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { error?: string; usarPdf?: boolean } | null;
    throw Object.assign(new Error(mensajeDeError(res.status, cuerpo)), { usarPdf: Boolean(cuerpo?.usarPdf) });
  }
  return res;
}

/**
 * VISOR DE ADJUNTOS del chat (2026-10-22). Pedido de Nicolás Rivera: «evitemos
 * la descarga de archivos y tengamos previsualizadores». Al tocar un adjunto
 * SIEMPRE se abre primero este visor; Descargar es un ícono pequeño DENTRO del
 * visor («ya después de abierto, si decidimos si lo descargamos o no»).
 *
 *   - Imagen: zoom (botones, doble clic, Ctrl + rueda o pellizco del
 *     trackpad), arrastrar para moverse, y navegación entre las imágenes de la
 *     conversación (flechas, teclado ← → y deslizar en el celular).
 *   - PDF, Word, PowerPoint y Excel viejo: páginas dibujadas con pdf.js (el
 *     mismo dibujo del visor seguro del SGC); lo que no es PDF lo convierte
 *     Microsoft Graph en el servidor.
 *   - Excel (.xlsx): las hojas en pestañas, con el motor del visor de Excel del
 *     SGC; con «PDF» se ve como lo pagina Office.
 *   - Markdown: renderizado seguro (el mismo del chat, sin HTML crudo).
 *   - CSV: tabla. Texto y código: con resaltado básico.
 *   - Audio y video: el reproductor del navegador, en streaming.
 *   - Lo demás: «sin vista previa» y Descargar.
 *
 * Todo pasa por /api/chat/attachments/<id>/vista, que repite la puerta del hilo.
 */
export default function ChatAttachmentViewer({
  adjuntos,
  indice,
  onIndice,
  onClose,
}: {
  adjuntos: AdjuntoVisor[];
  indice: number;
  onIndice: (i: number) => void;
  onClose: () => void;
}) {
  const movil = useMediaQuery('(max-width: 768px)') ?? false;
  const actual = adjuntos[Math.min(Math.max(indice, 0), adjuntos.length - 1)];
  const tipo: TipoVisor = actual ? tipoDeVisor(actual.contentType, actual.fileName) : 'ninguno';
  const vista = actual ? urlVistaAdjunto(actual.downloadUrl) : null;
  const tipoEfectivo: TipoVisor = vista || tipo === 'imagen' ? tipo : 'ninguno';
  const [zoom, setZoom] = useState(1);
  const hayVarios = adjuntos.length > 1;
  const conZoom = tipoEfectivo === 'imagen' || tipoEfectivo === 'pdf' || tipoEfectivo === 'office';

  useEffect(() => setZoom(1), [actual?.id]);

  const anterior = useCallback(() => {
    if (indice > 0) onIndice(indice - 1);
  }, [indice, onIndice]);
  const siguiente = useCallback(() => {
    if (indice < adjuntos.length - 1) onIndice(indice + 1);
  }, [indice, adjuntos.length, onIndice]);
  const acercar = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_PASO)), []);
  const alejar = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_PASO)), []);

  // Teclado: ← → navegan, + − acercan y alejan (Esc ya lo maneja el Modal).
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const destino = e.target as HTMLElement | null;
      if (destino && (destino.tagName === 'INPUT' || destino.tagName === 'TEXTAREA' || destino.isContentEditable)) return;
      if (e.key === 'ArrowLeft' && hayVarios) anterior();
      else if (e.key === 'ArrowRight' && hayVarios) siguiente();
      else if ((e.key === '+' || e.key === '=') && conZoom) acercar();
      else if (e.key === '-' && conZoom) alejar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [hayVarios, conZoom, anterior, siguiente, acercar, alejar]);

  if (!actual) return null;

  return (
    <Modal
      opened
      onClose={onClose}
      withCloseButton={false}
      centered
      fullScreen={movil}
      size={tipoEfectivo === 'audio' ? 'md' : '90vw'}
      padding={0}
      radius={movil ? 0 : 'md'}
      // Igual que el visor de imágenes de antes: bloquear el scroll del body lo
      // nota el ResizeObserver del hilo y lo manda al fondo (iPhone).
      lockScroll={false}
      // Por encima del panel de Multimedia, que también es un Modal.
      zIndex={400}
      overlayProps={{ backgroundOpacity: 0.85, blur: 2 }}
      classNames={{ content: `chat-visor__contenido chat-visor__contenido--doc${movil ? ' chat-visor__contenido--movil' : ''}`, body: 'chat-visor__cuerpo' }}
      aria-label={`Vista previa de ${actual.fileName}`}
    >
      <Group justify='space-between' wrap='nowrap' gap='xs' className='chat-visor__barra' data-testid='chat-visor-barra'>
        <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
          <Text size='sm' fw={600} lineClamp={1} style={{ minWidth: 0 }} title={actual.fileName}>
            {actual.fileName}
          </Text>
          {actual.sizeBytes !== null && (
            <Text span size='xs' className='chat-text-muted' style={{ flexShrink: 0 }}>
              {formatBytes(actual.sizeBytes)}
            </Text>
          )}
        </Group>
        <Group gap={2} wrap='nowrap' style={{ flexShrink: 0 }}>
          {hayVarios && (
            <>
              <ActionIcon variant='subtle' color='gray' onClick={anterior} disabled={indice === 0} aria-label='Anterior'>
                <IconChevronLeft size={18} />
              </ActionIcon>
              <Text size='xs' className='chat-text-muted' data-testid='chat-visor-contador'>
                {indice + 1} de {adjuntos.length}
              </Text>
              <ActionIcon variant='subtle' color='gray' onClick={siguiente} disabled={indice === adjuntos.length - 1} aria-label='Siguiente'>
                <IconChevronRight size={18} />
              </ActionIcon>
            </>
          )}
          {conZoom && (
            <>
              <ActionIcon variant='subtle' color='gray' onClick={alejar} disabled={zoom <= ZOOM_MIN} aria-label='Alejar'>
                <IconZoomOut size={18} />
              </ActionIcon>
              {!movil && (
                <Text size='xs' className='chat-text-muted' w={38} ta='center'>
                  {Math.round(zoom * 100)} %
                </Text>
              )}
              <ActionIcon variant='subtle' color='gray' onClick={acercar} disabled={zoom >= ZOOM_MAX} aria-label='Acercar'>
                <IconZoomIn size={18} />
              </ActionIcon>
              {zoom !== 1 && (
                <ActionIcon variant='subtle' color='gray' onClick={() => setZoom(1)} aria-label='Tamaño original'>
                  <IconZoomReset size={18} />
                </ActionIcon>
              )}
            </>
          )}
          <Tooltip label='Descargar' withArrow>
            <ActionIcon
              component='a'
              href={actual.downloadUrl}
              download={actual.fileName}
              variant='subtle'
              color='gray'
              aria-label={`Descargar ${actual.fileName}`}
              data-testid='chat-visor-descargar'
            >
              <IconDownload size={17} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant='subtle' color='gray' onClick={onClose} aria-label='Cerrar' data-testid='chat-visor-cerrar'>
            <IconX size={18} />
          </ActionIcon>
        </Group>
      </Group>

      <div className='chat-visor__area' data-tipo={tipoEfectivo} data-testid='chat-visor-area'>
        {tipoEfectivo === 'imagen' && (
          <VistaImagen
            key={actual.id}
            // La misma URL de la miniatura: ya está en la caché del navegador.
            src={urlImagenEnLinea(actual.downloadUrl)}
            alt={actual.fileName}
            zoom={zoom}
            setZoom={setZoom}
            onAnterior={hayVarios ? anterior : undefined}
            onSiguiente={hayVarios ? siguiente : undefined}
          />
        )}
        {(tipoEfectivo === 'pdf' || tipoEfectivo === 'office') && vista && <VistaPdf key={actual.id} url={vista} zoom={zoom} convertido={tipoEfectivo === 'office'} />}
        {tipoEfectivo === 'hoja' && vista && <VistaHoja key={actual.id} url={vista} />}
        {(tipoEfectivo === 'markdown' || tipoEfectivo === 'csv' || tipoEfectivo === 'texto') && vista && (
          <VistaTexto key={actual.id} url={vista} tipo={tipoEfectivo} fileName={actual.fileName} />
        )}
        {tipoEfectivo === 'video' && vista && (
          <video key={actual.id} className='chat-visor__video' src={vista} controls playsInline preload='metadata' data-testid='chat-visor-video'>
            Su navegador no puede reproducir este video.
          </video>
        )}
        {tipoEfectivo === 'audio' && vista && (
          <Center p='lg'>
            <audio key={actual.id} src={vista} controls preload='metadata' style={{ width: '100%' }} data-testid='chat-visor-audio' />
          </Center>
        )}
        {tipoEfectivo === 'ninguno' && <SinVista adjunto={actual} />}
      </div>
    </Modal>
  );
}

/* ─────────────────────────────── Imagen ─────────────────────────────── */

function VistaImagen({
  src,
  alt,
  zoom,
  setZoom,
  onAnterior,
  onSiguiente,
}: {
  src: string;
  alt: string;
  zoom: number;
  setZoom: (z: number | ((z: number) => number)) => void;
  onAnterior?: () => void;
  onSiguiente?: () => void;
}) {
  const marcoRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [fallo, setFallo] = useState(false);
  const gesto = useRef<{ x: number; y: number; sl: number; st: number; mueve: boolean } | null>(null);

  // Tamaño «ajustado a la pantalla»: el de la imagen a zoom 1. Al acercar se
  // multiplica ese tamaño y el marco se desplaza (arrastrar o barras).
  const medir = useCallback(() => {
    const img = imgRef.current;
    if (img && zoom === 1) setBase({ w: img.clientWidth, h: img.clientHeight });
  }, [zoom]);

  useEffect(() => {
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [medir]);

  // Ctrl + rueda (o pellizco del trackpad, que el navegador reporta igual) acerca y aleja.
  useEffect(() => {
    const marco = marcoRef.current;
    if (!marco) return;
    const alRodar = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - e.deltaY * 0.01)));
    };
    marco.addEventListener('wheel', alRodar, { passive: false });
    return () => marco.removeEventListener('wheel', alRodar);
  }, [setZoom]);

  if (fallo) {
    return (
      <Center p='xl'>
        <Text size='sm' className='chat-text-muted'>
          No se pudo mostrar esta imagen (puede ser un formato que su navegador no lee, como HEIC). Use Descargar.
        </Text>
      </Center>
    );
  }

  const estilo =
    zoom === 1 || !base
      ? undefined
      : { width: Math.round(base.w * zoom), height: Math.round(base.h * zoom), maxWidth: 'none', maxHeight: 'none' };

  return (
    <div
      ref={marcoRef}
      className={`chat-visor__marco${zoom > 1 ? ' chat-visor__marco--zoom' : ''}`}
      onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
      onPointerDown={(e) => {
        const m = marcoRef.current;
        if (!m) return;
        gesto.current = { x: e.clientX, y: e.clientY, sl: m.scrollLeft, st: m.scrollTop, mueve: false };
      }}
      onPointerMove={(e) => {
        const g = gesto.current;
        const m = marcoRef.current;
        if (!g || !m || zoom === 1 || e.pointerType === 'touch') return;
        g.mueve = true;
        m.scrollLeft = g.sl - (e.clientX - g.x);
        m.scrollTop = g.st - (e.clientY - g.y);
      }}
      onPointerUp={(e) => {
        const g = gesto.current;
        gesto.current = null;
        if (!g || zoom !== 1) return;
        // Deslizar a los lados (celular o arrastre con el mouse) cambia de imagen.
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx > 0) onAnterior?.();
          else onSiguiente?.();
        }
      }}
      onPointerCancel={() => (gesto.current = null)}
      data-testid='chat-visor-imagen'
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pasa por la ruta autenticada, no por el optimizador */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className='chat-visor__imagen'
        decoding='async'
        draggable={false}
        onLoad={medir}
        onError={() => setFallo(true)}
        style={estilo}
      />
    </div>
  );
}

/* ──────────────────────────── PDF y Office ──────────────────────────── */

function VistaPdf({ url, zoom, convertido }: { url: string; zoom: number; convertido: boolean }) {
  const paginasRef = useRef<HTMLDivElement>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const generacion = useRef(0);
  const [estado, setEstado] = useState<{ tipo: 'cargando' } | { tipo: 'listo' } | { tipo: 'error'; mensaje: string }>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);

  const dibujar = useCallback(async (escala: number) => {
    const bytes = bytesRef.current;
    const cont = paginasRef.current;
    if (!bytes || !cont) return;
    const gen = ++generacion.current;
    const { renderPdf } = await import('../sgc/SgcSecureViewer');
    await renderPdf(bytes.slice(), escala * PDF_ESCALA_BASE, cont, () => gen !== generacion.current);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    bytesRef.current = null;
    setEstado({ tipo: 'cargando' });
    pedir(url, ctrl.signal)
      .then(async (res) => {
        bytesRef.current = new Uint8Array(await res.arrayBuffer());
        await dibujar(1);
        if (!ctrl.signal.aborted) setEstado({ tipo: 'listo' });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setEstado({ tipo: 'error', mensaje: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [url, intento, dibujar]);

  useEffect(() => {
    if (estado.tipo === 'listo') void dibujar(zoom);
    // Solo cuando cambia el zoom: la primera vez ya se dibujó al cargar.
  }, [zoom]);

  return (
    <>
      {estado.tipo === 'cargando' && (
        <Cargando texto={convertido ? 'Preparando la vista previa del documento…' : 'Cargando el documento…'} />
      )}
      {estado.tipo === 'error' && <ErrorVista mensaje={estado.mensaje} onReintentar={() => setIntento((n) => n + 1)} />}
      <div
        ref={paginasRef}
        className='chat-visor__paginas'
        style={{ display: estado.tipo === 'error' ? 'none' : undefined }}
        data-testid='chat-visor-pdf'
      />
    </>
  );
}

/* ─────────────────────────────── Excel ──────────────────────────────── */

interface HojasDto {
  hojas: { nombre: string; html: string }[];
  css: string;
  /** Fórmulas sin resultado guardado (libro hecho por un programa): en «Hojas» saldrían vacías. */
  formulasSinCalcular?: number;
}

/** Documento aislado de una hoja: sin scripts (sandbox vacío + CSP), solo estilos. */
function documentoHoja(css: string, html: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<style>body{margin:12px;background:#fff;color:#111;font:11pt Calibri,Carlito,Arial,sans-serif}table.sgc-hoja td{padding:1px 4px}p{font-size:10pt;color:#555}</style>',
    `<style>${css.replace(/<\/style/gi, '')}</style>`,
    '</head><body>',
    html,
    '</body></html>',
  ].join('');
}

function VistaHoja({ url }: { url: string }) {
  const [modo, setModo] = useState<'hojas' | 'pdf'>('hojas');
  const [datos, setDatos] = useState<HojasDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [hoja, setHoja] = useState<string | null>('0');
  // Libro con fórmulas sin calcular: se abre en PDF (Excel Online las calcula) y se avisa.
  const [sinCalcular, setSinCalcular] = useState(0);
  const avisado = useRef(false);

  useEffect(() => {
    if (modo !== 'hojas') return;
    const ctrl = new AbortController();
    setError(null);
    setDatos(null);
    pedir(url, ctrl.signal)
      .then(async (res) => {
        const d = (await res.json()) as HojasDto;
        if (!ctrl.signal.aborted) {
          setDatos(d);
          setHoja('0');
          const n = d.formulasSinCalcular ?? 0;
          if (n > 0 && !avisado.current) {
            // Solo la primera vez: si la persona vuelve a «Hojas», se queda ahí.
            avisado.current = true;
            setSinCalcular(n);
            setModo('pdf');
          }
        }
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        // Un libro que exceljs no lee se ve como PDF (lo convierte Office).
        if ((e as { usarPdf?: boolean }).usarPdf) setModo('pdf');
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [url, modo, intento]);

  const urlPdf = `${url}?como=pdf`;

  return (
    <Stack gap={0} className='chat-visor__hoja'>
      <Group justify='flex-end' px='sm' py={6} className='chat-visor__subbarra'>
        <SegmentedControl
          size='xs'
          value={modo}
          onChange={(v) => setModo(v as 'hojas' | 'pdf')}
          data={[
            { value: 'hojas', label: 'Hojas' },
            { value: 'pdf', label: 'PDF' },
          ]}
          aria-label='Cómo ver el Excel'
        />
      </Group>
      {sinCalcular > 0 && (
        <Alert color='yellow' variant='light' radius={0} py={6} icon={<IconAlertTriangle size={16} />} data-testid='chat-visor-formulas'>
          <Text size='xs'>
            {modo === 'pdf'
              ? 'Este Excel trae fórmulas sin calcular (lo generó un programa). Se muestra como PDF, que sí las calcula.'
              : 'Este Excel trae fórmulas sin calcular: en esta vista esas celdas salen vacías. Use «PDF» para ver los resultados.'}
          </Text>
        </Alert>
      )}
      {modo === 'pdf' ? (
        <VistaPdfConZoom url={urlPdf} />
      ) : error ? (
        <ErrorVista mensaje={error} onReintentar={() => setIntento((n) => n + 1)} />
      ) : !datos ? (
        <Cargando texto='Leyendo las hojas del Excel…' />
      ) : datos.hojas.length === 0 ? (
        <Center p='xl'>
          <Text size='sm' className='chat-text-muted'>
            El libro no tiene hojas visibles.
          </Text>
        </Center>
      ) : (
        <Tabs value={hoja} onChange={setHoja} keepMounted={false} className='chat-visor__pestanas'>
          {datos.hojas.length > 1 && (
            <Tabs.List className='chat-visor__pestanas-lista'>
              {datos.hojas.map((h, i) => (
                <Tabs.Tab key={i} value={String(i)}>
                  {h.nombre}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          )}
          {datos.hojas.map((h, i) => (
            <Tabs.Panel key={i} value={String(i)} className='chat-visor__pestana'>
              <iframe
                title={`Hoja ${h.nombre}`}
                sandbox=''
                srcDoc={documentoHoja(datos.css, h.html)}
                className='chat-visor__iframe'
                data-testid='chat-visor-hoja'
              />
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </Stack>
  );
}

/** El PDF del Excel con su propio zoom (la barra del visor no lo maneja en modo hoja). */
function VistaPdfConZoom({ url }: { url: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <>
      <Group gap={2} justify='center' py={4}>
        <ActionIcon size='sm' variant='subtle' color='gray' onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_PASO))} aria-label='Alejar'>
          <IconZoomOut size={16} />
        </ActionIcon>
        <ActionIcon size='sm' variant='subtle' color='gray' onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_PASO))} aria-label='Acercar'>
          <IconZoomIn size={16} />
        </ActionIcon>
      </Group>
      <VistaPdf url={url} zoom={zoom} convertido />
    </>
  );
}

/* ───────────────────────── Markdown, CSV y texto ─────────────────────── */

function VistaTexto({ url, tipo, fileName }: { url: string; tipo: 'markdown' | 'csv' | 'texto'; fileName: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [recortado, setRecortado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    setTexto(null);
    pedir(url, ctrl.signal)
      .then(async (res) => {
        const t = await res.text();
        if (ctrl.signal.aborted) return;
        setRecortado(res.headers.get('X-Visor-Recortado') === '1');
        setTexto(t);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [url, intento]);

  if (error) return <ErrorVista mensaje={error} onReintentar={() => setIntento((n) => n + 1)} />;
  if (texto === null) return <Cargando texto='Cargando…' />;

  return (
    <div className='chat-visor__texto' data-testid={`chat-visor-${tipo}`}>
      {recortado && (
        <Alert color='yellow' variant='light' mb='sm' py={6}>
          <Text size='xs'>El archivo es muy grande: se muestra solo el comienzo. Para verlo completo, descárguelo.</Text>
        </Alert>
      )}
      {tipo === 'markdown' && <ChatMarkdown content={texto} />}
      {tipo === 'csv' && <TablaCsv texto={texto} fileName={fileName} />}
      {tipo === 'texto' && <CodigoResaltado texto={texto} fileName={fileName} />}
    </div>
  );
}

function TablaCsv({ texto, fileName }: { texto: string; fileName: string }) {
  const { filas, recortado } = useMemo(() => parsearCsv(texto, separadorCsv(texto, fileName)), [texto, fileName]);
  if (filas.length === 0) {
    return (
      <Text size='sm' className='chat-text-muted'>
        El archivo está vacío.
      </Text>
    );
  }
  const [encabezado, ...cuerpo] = filas;
  return (
    <>
      <Table.ScrollContainer minWidth={300} className='chat-visor__tabla'>
        <Table striped highlightOnHover withTableBorder withColumnBorders stickyHeader fz='xs'>
          <Table.Thead>
            <Table.Tr>
              {encabezado.map((c, i) => (
                <Table.Th key={i}>{c}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {cuerpo.map((f, i) => (
              <Table.Tr key={i}>
                {f.map((c, j) => (
                  <Table.Td key={j}>{c}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {recortado && (
        <Text size='xs' className='chat-text-muted' mt='xs'>
          Se muestran las primeras {filas.length} filas.
        </Text>
      )}
    </>
  );
}

function CodigoResaltado({ texto, fileName }: { texto: string; fileName: string }) {
  const fichas = useMemo(() => resaltar(texto, lenguajeDe(fileName)), [texto, fileName]);
  return (
    <pre className='chat-visor__codigo'>
      <code>
        {fichas.map((f, i) =>
          f.clase === 'texto' ? (
            f.texto
          ) : (
            <span key={i} className={`chat-visor__tk chat-visor__tk--${f.clase}`}>
              {f.texto}
            </span>
          )
        )}
      </code>
    </pre>
  );
}

/* ──────────────────────────── Estados comunes ───────────────────────── */

function Cargando({ texto }: { texto: string }) {
  return (
    <Center py='xl'>
      <Group gap='xs'>
        <Loader size='sm' />
        <Text size='sm' className='chat-text-muted'>
          {texto}
        </Text>
      </Group>
    </Center>
  );
}

function ErrorVista({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <Center p='lg'>
      <Alert color='red' variant='light' icon={<IconAlertTriangle size={18} />} maw={460} data-testid='chat-visor-error'>
        <Stack gap='xs'>
          <Text size='sm'>{mensaje}</Text>
          <Button size='xs' variant='light' w='fit-content' leftSection={<IconRefresh size={14} />} onClick={onReintentar}>
            Reintentar
          </Button>
        </Stack>
      </Alert>
    </Center>
  );
}

function SinVista({ adjunto }: { adjunto: AdjuntoVisor }) {
  return (
    <Center p='xl'>
      <Stack align='center' gap='xs' data-testid='chat-visor-sin-vista'>
        <IconFile size={40} stroke={1.3} className='chat-text-muted' />
        <Text size='sm' fw={500} ta='center'>
          Este tipo de archivo no tiene vista previa en SynerLink.
        </Text>
        <Button
          component='a'
          href={adjunto.downloadUrl}
          download={adjunto.fileName}
          size='xs'
          variant='light'
          leftSection={<IconDownload size={14} />}
        >
          Descargar
        </Button>
      </Stack>
    </Center>
  );
}
