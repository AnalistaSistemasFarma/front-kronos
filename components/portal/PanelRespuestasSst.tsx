'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, ScrollArea, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconFileSpreadsheet, IconSearch, IconShieldLock } from '@tabler/icons-react';
import { COLOR_ESTADO } from '@/lib/theme/estados';
import { textoDeRespuesta } from '../../lib/portal/formulario';
import type { TablaEnviosSst } from '../../lib/portal/formularios-sst';

/**
 * FORMULARIOS SST — tabla de respuestas (Cristian Baldión, 2026-10-20). Solo la ven el administrador y los lectores SST: el servidor lo
 * exige en cada ruta (403 para los demás). Misma ventana y misma tabla que las respuestas de Formación, con buscador y exportación a
 * Excel. Los avisos van ARRIBA y con color. Los envíos no se editan ni se borran desde aquí.
 */

const QUIEBRE = { overflowWrap: 'anywhere' } as const;
const fechaLarga = (v: string) => new Date(v).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });

export default function PanelRespuestasSst({ codigo, titulo, onCerrar }: { codigo: string; titulo: string; onCerrar: () => void }) {
  const [tabla, setTabla] = useState<TablaEnviosSst | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const base = `/api/portal/formularios-sst/${encodeURIComponent(codigo)}/respuestas`;

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(base, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar las respuestas.'));
      setTabla(data as unknown as TablaEnviosSst);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const filas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!tabla || !f) return tabla?.filas ?? [];
    return tabla.filas.filter((x) => [x.correo, ...Object.values(x.respuestas).map((v) => textoDeRespuesta(v))].some((t) => t.toLowerCase().includes(f)));
  }, [tabla, filtro]);

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label={`Respuestas: ${titulo}`}
      data-testid='panel-respuestas-sst'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja portal-th__visor-caja--respuestas'>
        <header className='portal-th__visor-barra'>
          <strong>Respuestas · {titulo}</strong>
          <div className='portal-th__visor-acciones'>
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>
        {error && (
          <Stack gap='xs' px='md' pt='md'>
            <Alert color={COLOR_ESTADO.error} icon={<IconAlertCircle size={18} />} role='alert' data-testid='respuestas-sst-error'>
              {error}
            </Alert>
          </Stack>
        )}
        <Group gap='sm' p='md' wrap='wrap' align='center'>
          <TextInput
            type='search'
            aria-label='Buscar en las respuestas'
            placeholder='Buscar por correo o respuesta'
            leftSection={<IconSearch size={16} />}
            size='md'
            value={filtro}
            onChange={(e) => setFiltro(e.currentTarget.value)}
            flex='1 1 240px'
          />
          <Button component='a' href={`${base}/excel`} leftSection={<IconFileSpreadsheet size={16} />} data-testid='exportar-excel-sst'>
            Exportar a Excel
          </Button>
        </Group>
        <Stack gap='xs' px='md'>
          <Alert color={COLOR_ESTADO.advertencia} icon={<IconShieldLock size={18} />} p='xs'>
            Datos personales sensibles (Ley 1581 de 2012): uso exclusivo del SG-SST. No los reenvíe ni los publique.
          </Alert>
          <Text size='sm' c='dimmed' data-testid='conteo-respuestas-sst'>
            {tabla ? `${tabla.total} respuesta(s)${tabla.truncado ? ` · se muestran las ${tabla.filas.length} más recientes; el Excel trae más` : ''}` : error ? '' : 'Cargando…'}
          </Text>
        </Stack>
        <ScrollArea flex={1} mih={0} type='auto' px='md' pb='md'>
          {tabla && tabla.filas.length === 0 ? (
            <Text c='dimmed' ta='center' my='xl' data-testid='respuestas-sst-vacio'>
              Todavía nadie ha enviado este formulario.
            </Text>
          ) : (
            tabla && (
              <Table striped highlightOnHover stickyHeader verticalSpacing='sm' miw={(tabla.columnas.length + 2) * 160} data-testid='tabla-respuestas-sst'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th miw={200}>Correo</Table.Th>
                    <Table.Th miw={160}>Enviado</Table.Th>
                    {tabla.columnas.map((c, i) => (
                      <Table.Th key={c.id} title={`${i + 1}. ${c.texto}`} miw={140} maw={280}>
                        <Text inherit lineClamp={3}>
                          {i + 1}. {c.texto}
                        </Text>
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filas.map((f) => (
                    <Table.Tr key={f.id} data-testid='fila-respuesta-sst'>
                      <Table.Td style={QUIEBRE}>{f.correo}</Table.Td>
                      <Table.Td>{fechaLarga(f.enviadaEl)}</Table.Td>
                      {tabla.columnas.map((c) => (
                        <Table.Td key={c.id} maw={280} style={QUIEBRE}>
                          {textoDeRespuesta(f.respuestas[c.id])}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
