'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconBold, IconCheck, IconDeviceFloppy, IconEye, IconLock, IconTrash, IconX } from '@tabler/icons-react';
import SgcDocumentViewerModal from '../SgcDocumentViewerModal';
import { sgcSend } from '../useSgcFetch';
import { BIOMED_FONT_SIZE, BIOMED_MARK_SIZE, type BiomedAnotacion } from '../../../lib/biomedica/anotaciones';
import type { BiomedRegistroDto } from '../../../lib/biomedica/db';

/**
 * DILIGENCIAR un formato vigente del SGC (Ingeniería biomédica, 2026-11-06):
 * «como si lo imprimiéramos y lo llenáramos a mano». Se ve el formato tal cual
 * (con la marca de copia controlada) y encima se coloca, con un clic, TEXTO
 * con fuente fija (se permite negrilla, no cambiar tipo ni tamaño) o una
 * MARCA «X». El formato del SGC no cambia. Si el formato dejó de estar
 * vigente, el registro queda bloqueado (solo consulta).
 */

type Pagina = { src: string; widthPt: number; heightPt: number };
type Modo = 'texto' | 'marca';

let contador = 0;
const nuevoId = () => `a${Date.now().toString(36)}${(contador++).toString(36)}`;

async function paginasDe(bytes: Uint8Array): Promise<Pagina[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const out: Pagina[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({ src: canvas.toDataURL('image/png'), widthPt: base.width, heightPt: base.height });
  }
  return out;
}

export default function BiomedEditor({ idCompany, idRegistro, onClose, onChanged }: { idCompany: number; idRegistro: number; onClose: () => void; onChanged: () => void }) {
  const [registro, setRegistro] = useState<BiomedRegistroDto | null>(null);
  const [paginas, setPaginas] = useState<Pagina[] | null>(null);
  const [anotaciones, setAnotaciones] = useState<BiomedAnotacion[]>([]);
  const [modo, setModo] = useState<Modo>('texto');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [cambios, setCambios] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [verPdf, setVerPdf] = useState<string | null>(null);
  const [anchos, setAnchos] = useState<Record<number, number>>({});
  const refs = useRef<Record<number, HTMLDivElement | null>>({});

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/biomedica/registros/${idRegistro}?company=${idCompany}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error || `Error ${res.status}`);
    setRegistro(body as BiomedRegistroDto);
    setAnotaciones((body as BiomedRegistroDto).anotaciones);
    setCambios(false);
  }, [idCompany, idRegistro]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        await cargar();
        const res = await fetch(`/api/biomedica/registros/${idRegistro}/pdf?company=${idCompany}&vacio=1`, { cache: 'no-store' });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Error ${res.status}`);
        const p = await paginasDe(new Uint8Array(await res.arrayBuffer()));
        if (!cancel) setPaginas(p);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [cargar, idCompany, idRegistro]);

  // Ancho real de cada página en pantalla (para escalar la fuente fija al tamaño del formato).
  useEffect(() => {
    if (!paginas) return;
    const medir = () => setAnchos(Object.fromEntries(Object.entries(refs.current).map(([k, el]) => [Number(k), el?.clientWidth ?? 0])));
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [paginas]);

  const editable = Boolean(registro?.puedeEditar);

  const colocar = (page: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 10000) / 100;
    const y = Math.round(((e.clientY - r.top) / r.height) * 10000) / 100;
    const id = nuevoId();
    setAnotaciones((a) => [...a, modo === 'marca' ? { id, tipo: 'marca', page, x, y } : { id, tipo: 'texto', page, x, y, texto: '', negrilla: false }]);
    setSeleccion(id);
    setCambios(true);
  };

  const cambiar = (id: string, patch: Partial<Extract<BiomedAnotacion, { tipo: 'texto' }>>) => {
    setAnotaciones((a) => a.map((x) => (x.id === id && x.tipo === 'texto' ? { ...x, ...patch } : x)));
    setCambios(true);
  };
  const quitar = (id: string) => {
    setAnotaciones((a) => a.filter((x) => x.id !== id));
    setSeleccion(null);
    setCambios(true);
  };

  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      await sgcSend(`/api/biomedica/registros/${idRegistro}`, 'PUT', { company: idCompany, anotaciones: anotaciones.filter((a) => a.tipo === 'marca' || a.texto.trim()) });
      await cargar();
      setOk('Formato guardado.');
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cerrar = async () => {
    if (cambios && !(await guardar())) return;
    setBusy(true);
    setError(null);
    try {
      await sgcSend(`/api/biomedica/registros/${idRegistro}/cerrar`, 'POST', { company: idCompany });
      await cargar();
      setOk('Registro cerrado: queda como evidencia.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verDiligenciado = async () => {
    try {
      const res = await fetch(`/api/biomedica/registros/${idRegistro}/pdf?company=${idCompany}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Error ${res.status}`);
      setVerPdf(URL.createObjectURL(await res.blob()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sel = anotaciones.find((a) => a.id === seleccion);

  return (
    <>
      <Modal opened onClose={onClose} fullScreen title={registro ? `${registro.code} V${registro.versionNumber} · ${registro.equipo}${registro.serial ? ` (serial ${registro.serial})` : ''}` : 'Formato'} data-testid='biomed-editor'>
        <Stack gap='sm'>
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='biomed-editor-error'>
              {error}
            </Alert>
          )}
          {ok && (
            <Alert color='green' icon={<IconCheck size={18} />} withCloseButton onClose={() => setOk(null)}>
              {ok}
            </Alert>
          )}
          {registro?.motivoBloqueo && (
            <Alert color='orange' icon={<IconLock size={18} />} title='Formato bloqueado' data-testid='biomed-bloqueado'>
              {registro.motivoBloqueo}
            </Alert>
          )}
          <Group justify='space-between' wrap='wrap' gap='xs' style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--mantine-color-body)', paddingBottom: 6 }}>
            <Group gap='xs'>
              <Badge variant='light' color={registro?.estado === 'cerrado' ? 'green' : registro?.bloqueado ? 'orange' : 'blue'}>
                {registro?.estado === 'cerrado' ? 'Cerrado' : registro?.bloqueado ? 'Bloqueado' : 'Borrador'}
              </Badge>
              {editable && (
                <>
                  <SegmentedControl
                    size='xs'
                    value={modo}
                    onChange={(v) => setModo(v as Modo)}
                    data={[
                      { value: 'texto', label: 'Escribir texto' },
                      { value: 'marca', label: 'Marcar X' },
                    ]}
                    data-testid='biomed-modo'
                  />
                  <Text size='xs' c='dimmed'>
                    Toque el formato donde va el dato. Fuente fija ({BIOMED_FONT_SIZE} pt).
                  </Text>
                </>
              )}
            </Group>
            <Group gap='xs'>
              {editable && sel?.tipo === 'texto' && (
                <Tooltip label='Negrilla'>
                  <Button size='xs' variant={sel.negrilla ? 'filled' : 'default'} onClick={() => cambiar(sel.id, { negrilla: !sel.negrilla })} aria-label='Negrilla'>
                    <IconBold size={14} />
                  </Button>
                </Tooltip>
              )}
              {editable && sel && (
                <Button size='xs' variant='light' color='red' leftSection={<IconTrash size={14} />} onClick={() => quitar(sel.id)}>
                  Quitar
                </Button>
              )}
              <Button size='xs' variant='default' leftSection={<IconEye size={14} />} onClick={() => void verDiligenciado()} data-testid='biomed-ver-pdf'>
                Ver diligenciado
              </Button>
              {editable && (
                <>
                  <Button size='xs' variant='light' leftSection={<IconDeviceFloppy size={14} />} loading={busy} disabled={!cambios} onClick={() => void guardar()} data-testid='biomed-guardar'>
                    Guardar
                  </Button>
                  <Button size='xs' leftSection={<IconCheck size={14} />} loading={busy} onClick={() => void cerrar()} data-testid='biomed-cerrar'>
                    Cerrar registro
                  </Button>
                </>
              )}
            </Group>
          </Group>

          {!paginas && !error && (
            <Group justify='center' my='xl'>
              <Loader />
            </Group>
          )}
          {paginas?.map((p, i) => {
            const page = i + 1;
            const factor = (anchos[page] || 0) / p.widthPt;
            return (
              <div
                key={page}
                ref={(el) => {
                  refs.current[page] = el;
                }}
                onClick={(e) => colocar(page, e)}
                onContextMenu={(e) => e.preventDefault()}
                style={{ position: 'relative', width: '100%', maxWidth: 1100, margin: '0 auto', aspectRatio: `${p.widthPt} / ${p.heightPt}`, backgroundImage: `url(${p.src})`, backgroundSize: '100% 100%', boxShadow: '0 1px 4px rgba(0,0,0,.2)', cursor: editable ? (modo === 'marca' ? 'crosshair' : 'text') : 'default', userSelect: 'none' }}
                data-testid='biomed-pagina'
              >
                {anotaciones
                  .filter((a) => a.page === page)
                  .map((a) =>
                    a.tipo === 'marca' ? (
                      <span
                        key={a.id}
                        onClick={() => editable && setSeleccion(a.id)}
                        style={{ position: 'absolute', left: `${a.x}%`, top: `${a.y}%`, fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, fontSize: BIOMED_MARK_SIZE * factor, lineHeight: 1, color: '#0d2673', outline: seleccion === a.id ? '1px dashed #1c7ed6' : undefined, cursor: editable ? 'pointer' : 'default' }}
                        data-testid='biomed-marca'
                      >
                        <IconX size={Math.max(8, BIOMED_MARK_SIZE * factor)} stroke={3} />
                      </span>
                    ) : (
                      <textarea
                        key={a.id}
                        value={a.texto}
                        readOnly={!editable}
                        autoFocus={seleccion === a.id && !a.texto}
                        onFocus={() => setSeleccion(a.id)}
                        onChange={(e) => cambiar(a.id, { texto: e.currentTarget.value.slice(0, 300) })}
                        rows={Math.max(1, a.texto.split('\n').length)}
                        spellCheck={false}
                        style={{
                          position: 'absolute',
                          left: `${a.x}%`,
                          top: `${a.y}%`,
                          minWidth: 40 * factor,
                          width: `${Math.max(4, Math.max(...a.texto.split('\n').map((l) => l.length)) + 1)}ch`,
                          fontFamily: 'Helvetica, Arial, sans-serif',
                          fontWeight: a.negrilla ? 700 : 400,
                          fontSize: BIOMED_FONT_SIZE * factor,
                          lineHeight: 1.15,
                          color: '#0d2673',
                          background: editable ? 'rgba(255,255,180,.35)' : 'transparent',
                          border: seleccion === a.id ? '1px dashed #1c7ed6' : '1px solid transparent',
                          padding: 0,
                          margin: 0,
                          resize: 'none',
                          overflow: 'hidden',
                          whiteSpace: 'pre',
                        }}
                        data-testid='biomed-texto'
                      />
                    )
                  )}
              </div>
            );
          })}
        </Stack>
      </Modal>
      <SgcDocumentViewerModal fileUrl={verPdf} title='Formato diligenciado' onClose={() => setVerPdf(null)} />
    </>
  );
}
