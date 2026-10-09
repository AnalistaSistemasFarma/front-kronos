'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, List, Paper, Progress, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconCloudDownload } from '@tabler/icons-react';
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

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ImportarDesdeForms({ onImportado, deshabilitado }: { onImportado: (i: ImportacionForms) => void; deshabilitado?: boolean }) {
  const [url, setUrl] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [etapa, setEtapa] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ titulo: string; preguntas: number; datos: string[]; advertencias: string[] } | null>(null);
  const vivo = useRef(true);
  const avisos = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // Los avisos van ARRIBA: al aparecer uno, se lleva a la persona hasta él.
  useEffect(() => {
    if (!error && !listo) return;
    window.requestAnimationFrame(() => avisos.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [error, listo]);

  const importar = async () => {
    setError(null);
    setListo(null);
    const enlace = validarEnlaceForms(url);
    if (!enlace.ok) {
      setError(enlace.error);
      return;
    }
    setTrabajando(true);
    setProgreso(2);
    setEtapa('Iniciando la importación');
    try {
      const res = await fetch('/api/portal/formularios/importar-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: enlace.url }),
      });
      const inicio = await leerJson(res);
      if (!res.ok) throw new Error(String(inicio?.error ?? 'No se pudo iniciar la importación.'));
      const id = String(inicio.id);

      for (let i = 0; i < INTENTOS_MAX; i++) {
        await esperar(ESPERA_MS);
        if (!vivo.current) return;
        const r = await fetch(`/api/portal/formularios/importar-forms/${id}`, { cache: 'no-store' });
        const s = (await leerJson(r)) as unknown as EstadoImportacion & { error?: string };
        if (!r.ok) throw new Error(String(s?.error ?? 'No se pudo consultar la importación.'));
        if (!vivo.current) return;
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
      if (vivo.current) setError((e as Error).message);
    } finally {
      if (vivo.current) setTrabajando(false);
    }
  };

  return (
    <Paper withBorder radius='md' p='sm' data-testid='importar-forms'>
      <Stack gap='sm'>
        {/* Avisos ARRIBA y con color (convención del equipo). */}
        <div ref={avisos}>
          <Stack gap='xs'>
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
          onChange={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !trabajando && url.trim()) void importar();
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
          <Button
            leftSection={<IconCloudDownload size={16} />}
            loading={trabajando}
            disabled={trabajando || deshabilitado || !url.trim()}
            onClick={() => void importar()}
            data-testid='importar-forms-boton'
          >
            Importar desde Microsoft Forms
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
