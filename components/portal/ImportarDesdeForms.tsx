'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, List, Paper, Progress, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconCloudDownload, IconX } from '@tabler/icons-react';
import { leerJson } from './PortalContenido';
import { claveDeDato } from '../../lib/portal/constructor-formulario';
import { validarEnlaceForms, type EstadoImportacion, type ImportacionForms } from '../../lib/portal/importar-forms';

/**
 * FORMACIÓN — IMPORTAR DESDE MICROSOFT FORMS (Cristian Baldión, 2026-10-09).
 *
 * En "Crear encuesta" / "Crear evaluación": se pega el ENLACE del formulario de Microsoft Forms (el de
 * responder, público) y el servicio importador lo lee. Una barra de progreso de 0 a 100 % muestra el
 * avance REAL (etapas del servicio). Al terminar, las preguntas se cargan en el constructor para
 * revisarlas, EDITARLAS y guardarlas: aquí no se guarda nada. Los avisos van arriba y con color.
 */

const ESPERA_MS = 600;
/** ~90 s: más que eso es que algo se trabó. */
const INTENTOS_MAX = 150;
/** Fallas SEGUIDAS de red o del servidor (502/503/504) que se toleran antes de rendirse. */
const REINTENTOS_MAX = 3;

/** Error que vale la pena reintentar: la red, o el importador que no respondió esta vez. */
class ErrorTransitorio extends Error {}
const esTransitorio = (status: number) => status === 502 || status === 503 || status === 504;

const NOMBRE_DATO = { nombre: 'nombre', correo: 'correo', cedula: 'cédula' } as const;

/** Qué preguntas pasan a «Datos que se piden» (el constructor ya sabe pedirlos): se avisa para que no parezca que faltan. */
function datosDeLaPersona(imp: ImportacionForms): string[] {
  const claves = new Set<keyof typeof NOMBRE_DATO>();
  for (const p of imp.preguntas) {
    const k = p.tipo === 'texto' ? claveDeDato(p.texto) : null;
    if (k) claves.add(k);
  }
  return [...claves].map((k) => NOMBRE_DATO[k]);
}

/** Espera `ms`, o termina antes si se cancela. */
const esperar = (ms: number, señal: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    señal.addEventListener('abort', () => {
      clearTimeout(t);
      ok();
    }, { once: true });
  });

/**
 * `fetch` que reintenta las fallas TRANSITORIAS (red caída un momento, 502/503/504) hasta
 * REINTENTOS_MAX veces, con espera creciente. Un error definitivo (400, 403, 404…) no se reintenta.
 */
async function conReintentos(hacer: () => Promise<Response>, señal: AbortSignal): Promise<Response> {
  for (let intento = 0; ; intento++) {
    try {
      const res = await hacer();
      if (!esTransitorio(res.status) || intento >= REINTENTOS_MAX) return res;
    } catch (e) {
      if (señal.aborted || (e as Error).name === 'AbortError') throw e;
      if (intento >= REINTENTOS_MAX) throw new ErrorTransitorio('No hay conexión con el importador. Revise su red e intente de nuevo.');
    }
    await esperar(1000 * (intento + 1), señal);
    if (señal.aborted) throw new DOMException('Cancelada', 'AbortError');
  }
}

export function ImportarDesdeForms({
  onImportado,
  deshabilitado,
  hayContenido = false,
}: {
  onImportado: (i: ImportacionForms) => void;
  deshabilitado?: boolean;
  /** El constructor ya tiene algo escrito: importar lo REEMPLAZA, así que se pide confirmación antes. */
  hayContenido?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [etapa, setEtapa] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ titulo: string; preguntas: number; datos: string[]; advertencias: string[] } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [cancelada, setCancelada] = useState(false);
  const vivo = useRef(true);
  const avisos = useRef<HTMLDivElement | null>(null);
  const control = useRef<AbortController | null>(null);
  const trabajo = useRef<string | null>(null);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      control.current?.abort();
    };
  }, []);

  /** Cancela la importación en curso: deja de consultar y le pide al importador que suelte el navegador. */
  const cancelar = () => {
    control.current?.abort();
    const id = trabajo.current;
    if (id) void fetch(`/api/portal/formularios/importar-forms/${id}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
  };

  // Los avisos van ARRIBA: al aparecer uno, se lleva a la persona hasta él.
  useEffect(() => {
    if (!error && !listo && !confirmar && !cancelada) return;
    window.requestAnimationFrame(() => avisos.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [error, listo, confirmar, cancelada]);

  /** Botón «Importar»: si ya hay algo escrito, primero se confirma (importar lo reemplaza). */
  const pedirImportar = () => {
    setError(null);
    setListo(null);
    setCancelada(false);
    const enlace = validarEnlaceForms(url);
    if (!enlace.ok) {
      setError(enlace.error);
      return;
    }
    if (hayContenido) {
      setConfirmar(true);
      return;
    }
    void importar();
  };

  const importar = async () => {
    setConfirmar(false);
    setError(null);
    setListo(null);
    setCancelada(false);
    const enlace = validarEnlaceForms(url);
    if (!enlace.ok) {
      setError(enlace.error);
      return;
    }
    const c = new AbortController();
    control.current = c;
    trabajo.current = null;
    setTrabajando(true);
    setProgreso(2);
    setEtapa('Iniciando la importación');
    try {
      const res = await conReintentos(
        () =>
          fetch('/api/portal/formularios/importar-forms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: enlace.url }),
            signal: c.signal,
          }),
        c.signal
      );
      const inicio = await leerJson(res);
      if (!res.ok) throw new Error(String(inicio?.error ?? 'No se pudo iniciar la importación.'));
      const id = String(inicio.id);
      trabajo.current = id;

      for (let i = 0; i < INTENTOS_MAX; i++) {
        await esperar(ESPERA_MS, c.signal);
        if (c.signal.aborted || !vivo.current) return;
        const r = await conReintentos(() => fetch(`/api/portal/formularios/importar-forms/${id}`, { cache: 'no-store', signal: c.signal }), c.signal);
        const s = (await leerJson(r)) as unknown as EstadoImportacion & { error?: string };
        if (!r.ok) throw new Error(String(s?.error ?? 'No se pudo consultar la importación.'));
        if (c.signal.aborted || !vivo.current) return;
        setProgreso(s.progreso);
        setEtapa(s.etapa);
        if (s.estado === 'error') throw new Error(s.error ?? 'No se pudo importar el formulario.');
        if (s.estado === 'listo' && s.resultado) {
          onImportado(s.resultado);
          setListo({ titulo: s.resultado.titulo, preguntas: s.resultado.preguntas.length, datos: datosDeLaPersona(s.resultado), advertencias: s.resultado.advertencias });
          return;
        }
      }
      throw new Error('La importación tardó demasiado. Intente de nuevo.');
    } catch (e) {
      if (!vivo.current) return;
      if (c.signal.aborted || (e as Error).name === 'AbortError') {
        setCancelada(true);
        return;
      }
      setError((e as Error).message);
    } finally {
      if (control.current === c) control.current = null;
      if (vivo.current) setTrabajando(false);
    }
  };

  return (
    <Paper withBorder radius='md' p='sm' data-testid='importar-forms'>
      <Stack gap='sm'>
        {/* Avisos ARRIBA y con color (convención del equipo). */}
        <div ref={avisos}>
          <Stack gap='xs'>
            {confirmar && (
              <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='¿Reemplazar lo que ya escribió?' data-testid='importar-confirmar'>
                <Stack gap='xs'>
                  <Text size='sm'>Importar reemplaza el título, la descripción y las preguntas que ya escribió abajo. Esto no se puede deshacer.</Text>
                  <Group gap='xs'>
                    <Button size='xs' color='yellow' onClick={() => void importar()} data-testid='importar-confirmar-si'>
                      Reemplazar e importar
                    </Button>
                    <Button size='xs' variant='default' onClick={() => setConfirmar(false)} data-testid='importar-confirmar-no'>
                      Cancelar
                    </Button>
                  </Group>
                </Stack>
              </Alert>
            )}
            {cancelada && (
              <Alert color='gray' icon={<IconAlertCircle size={18} />} role='status' data-testid='importar-cancelada'>
                Importación cancelada. No se cambió nada de lo que tenía escrito.
              </Alert>
            )}
            {error && (
              <Alert color='red' icon={<IconAlertCircle size={18} />} role='alert' data-testid='importar-error'>
                {error}
              </Alert>
            )}
            {listo && (
              <Alert color='green' icon={<IconCircleCheck size={18} />} role='status' data-testid='importar-listo'>
                Se importaron {listo.preguntas} {listo.preguntas === 1 ? 'pregunta' : 'preguntas'}
                {listo.titulo ? ` de «${listo.titulo}»` : ''}
                {listo.datos.length > 0 ? ` (${listo.datos.join(' y ')} quedaron en «Datos que se piden»)` : ''}. Revíselas abajo, edítelas si lo necesita y guarde el formulario. Todavía no se guardó nada.
              </Alert>
            )}
            {listo && listo.advertencias.length > 0 && (
              <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Revise estas preguntas' data-testid='importar-advertencias'>
                <List size='sm'>
                  {listo.advertencias.map((a) => (
                    <List.Item key={a}>{a}</List.Item>
                  ))}
                </List>
              </Alert>
            )}
          </Stack>
        </div>

        <div>
          <Text fw={600}>Importar desde Microsoft Forms</Text>
          <Text size='sm' c='dimmed'>
            Opcional. Pegue el enlace para responder el formulario (debe ser público: «Cualquier persona con el vínculo puede responder»). Reemplaza lo que haya escrito abajo.
          </Text>
        </div>

        <TextInput
          label='Enlace del formulario de Microsoft Forms'
          placeholder='https://forms.cloud.microsoft/…'
          value={url}
          disabled={trabajando || deshabilitado}
          onChange={(e) => {
            setUrl(e.currentTarget.value);
            setConfirmar(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !trabajando && url.trim()) pedirImportar();
          }}
          data-testid='enlace-forms'
        />

        {trabajando && (
          <Stack gap={4} data-testid='importar-progreso'>
            <Group justify='space-between' wrap='nowrap'>
              <Text size='sm' data-testid='importar-etapa'>
                {etapa}
              </Text>
              <Text size='sm' fw={600} data-testid='importar-porcentaje'>
                {progreso} %
              </Text>
            </Group>
            <Progress value={progreso} size='lg' animated aria-label='Progreso de la importación' />
          </Stack>
        )}

        <Group justify='flex-end'>
          {trabajando && (
            <Button variant='default' leftSection={<IconX size={16} />} onClick={cancelar} data-testid='importar-cancelar'>
              Cancelar importación
            </Button>
          )}
          <Button
            leftSection={<IconCloudDownload size={16} />}
            loading={trabajando}
            disabled={trabajando || deshabilitado || !url.trim() || confirmar}
            onClick={pedirImportar}
            data-testid='importar-forms-boton'
          >
            Importar desde Microsoft Forms
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
