'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconClipboardList, IconFileSpreadsheet, IconListDetails, IconShieldLock } from '@tabler/icons-react';
import { COLOR_ESTADO } from '@/lib/theme/estados';
import { VisorFormulario } from './FormularioPropio';
import PanelRespuestasSst from './PanelRespuestasSst';

/**
 * FORMULARIOS SST (Cristian Baldión, 2026-10-20): los formularios propios de Seguridad y Salud en el Trabajo —«Reporte de actos y
 * condiciones inseguras» y «Condiciones de salud y sintomatología osteomuscular»—. Cualquier persona con sesión los puede abrir y enviar
 * (varias veces: cada reporte es nuevo); el administrador y los lectores SST, además, ven las respuestas y las exportan a Excel. Cada envío
 * se guarda en SharePoint (`FORMULARIOS SST`). Mismo estilo y componentes de Mantine que Formación; los avisos van ARRIBA y con color.
 */

interface Item {
  codigo: string;
  titulo: string;
  descripcion: string | null;
  datosSensibles: boolean;
}

export default function FormulariosSst({ onSinSesion }: { onSinSesion?: () => void }) {
  const [lista, setLista] = useState<Item[] | null>(null);
  const [puedeVer, setPuedeVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Item | null>(null);
  const [respuestas, setRespuestas] = useState<Item | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/formularios-sst', { cache: 'no-store' });
      if (res.status === 401) return onSinSesion?.();
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar los formularios.'));
      setLista(Array.isArray(data.formularios) ? (data.formularios as Item[]) : []);
      setPuedeVer(data.puedeVerRespuestas === true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onSinSesion]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cerrarFormulario = useCallback(() => setAbierto(null), []);
  const cerrarRespuestas = useCallback(() => setRespuestas(null), []);

  return (
    <Stack gap='md' data-testid='formularios-sst'>
      {/* Avisos ARRIBA y con color. */}
      {error && (
        <Alert color={COLOR_ESTADO.error} icon={<IconAlertCircle size={18} />} role='alert' data-testid='formularios-sst-error'>
          <Group justify='space-between' gap='sm' wrap='nowrap'>
            <Text inherit>{error}</Text>
            <Button size='xs' variant='light' onClick={() => void cargar()}>
              Reintentar
            </Button>
          </Group>
        </Alert>
      )}
      {!lista && !error && (
        <Group gap='xs'>
          <Loader size='sm' />
          <Text size='sm' c='dimmed'>
            Cargando formularios…
          </Text>
        </Group>
      )}

      {lista?.map((f) => (
        <Paper key={f.codigo} withBorder radius='md' p='md' data-testid={`formulario-sst-${f.codigo}`}>
          <Stack gap='xs'>
            <Text fw={700} fz='lg' role='heading' aria-level={3}>
              {f.titulo}
            </Text>
            {f.descripcion && (
              <Text size='sm' c='dimmed' lineClamp={4}>
                {f.descripcion}
              </Text>
            )}
            {f.datosSensibles && (
              <Alert color={COLOR_ESTADO.advertencia} icon={<IconShieldLock size={18} />} p='xs'>
                Pide datos de salud: le pedirá su autorización para tratarlos.
              </Alert>
            )}
            <Group gap='sm' wrap='wrap'>
              <Button leftSection={<IconClipboardList size={16} />} onClick={() => setAbierto(f)} data-testid={`abrir-sst-${f.codigo}`}>
                Abrir formulario
              </Button>
              {puedeVer && (
                <>
                  <Button variant='light' leftSection={<IconListDetails size={16} />} onClick={() => setRespuestas(f)} data-testid={`ver-respuestas-sst-${f.codigo}`}>
                    Ver respuestas
                  </Button>
                  <Button
                    variant='light'
                    component='a'
                    href={`/api/portal/formularios-sst/${encodeURIComponent(f.codigo)}/respuestas/excel`}
                    leftSection={<IconFileSpreadsheet size={16} />}
                    data-testid={`excel-sst-${f.codigo}`}
                  >
                    Exportar a Excel
                  </Button>
                </>
              )}
            </Group>
          </Stack>
        </Paper>
      ))}

      {abierto && <VisorFormulario rutaApi={`/api/portal/formularios-sst/${encodeURIComponent(abierto.codigo)}`} titulo={abierto.titulo} onCerrar={cerrarFormulario} />}
      {respuestas && <PanelRespuestasSst codigo={respuestas.codigo} titulo={respuestas.titulo} onCerrar={cerrarRespuestas} />}
    </Stack>
  );
}
