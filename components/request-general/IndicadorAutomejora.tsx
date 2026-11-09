'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ActionIcon, Alert, Anchor, Badge, Card, Collapse, Group, Loader, Select, SimpleGrid, Table, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconRefresh, IconTrendingUp } from '@tabler/icons-react';
import type { ResumenEmpresa, ResumenFlujo } from '../../lib/workflow/mejora-continua-rules';
import { textoDias } from '../../lib/workflow/mejora-continua-rules';

/**
 * INDICADOR DE AUTOMEJORA DE PROCESOS en el panel de Flujos de trabajo (2026-11-09; Nicolás
 * Rivera: «en el panel de flujos de trabajo voy a necesitar un indicador de automejora de
 * procesos»). La foto de todos los flujos de la empresa: cuellos de botella, sugerencias
 * pendientes, mejoras aplicadas y días ahorrados; y la lista de flujos por prioridad, que abre
 * el editor del flujo con su panel de Mejora continua. Sin permiso o sin empresas habilitadas,
 * no se muestra. Diseño: docs/flujos-mejora-continua.md.
 */

interface Respuesta {
  empresas: { idCompany: number; nombre: string }[];
  empresa: { idCompany: number; nombre: string } | null;
  calculadoEn?: string;
  total?: ResumenEmpresa;
  flujos?: ResumenFlujo[];
}

const MAX_FILAS = 8;

export default function IndicadorAutomejora({ from = 'workflows' }: { from?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [oculto, setOculto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(true);
  const [todos, setTodos] = useState(false);

  const cargar = useCallback(async (idEmpresa: string | null, refrescar = false) => {
    setCargando(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (idEmpresa) p.set('empresa', idEmpresa);
      if (refrescar) p.set('refrescar', '1');
      const res = await fetch(`/api/requests-general/mejora-continua/indicador?${p}`, { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setOculto(true);
        return;
      }
      const json = (await res.json().catch(() => null)) as (Respuesta & { error?: string }) | null;
      if (!res.ok || !json) throw new Error(json?.error || 'No se pudo calcular el indicador.');
      if (json.empresas.length === 0) {
        setOculto(true);
        return;
      }
      setDatos(json);
      setEmpresa(String(json.empresa?.idCompany ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular el indicador.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar(null);
  }, [cargar]);

  if (oculto) return null;

  const t = datos?.total;
  const flujos = (datos?.flujos ?? []).filter((f) => f.solicitudes > 0);
  const visibles = todos ? flujos : flujos.slice(0, MAX_FILAS);

  return (
    <Card shadow='sm' p='lg' radius='md' withBorder mb='6' data-testid='indicador-automejora'>
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <Group gap='sm' wrap='nowrap'>
          <ThemeIcon color='teal' variant='light' size='lg' radius='md'>
            <IconTrendingUp size={20} />
          </ThemeIcon>
          <div>
            <Text fw={700} size='lg'>
              Automejora de procesos
            </Text>
            <Text size='xs' c='dimmed'>
              Cómo funcionan los flujos en la realidad (últimos 6 meses) y qué se ha mejorado.
              {datos?.calculadoEn ? ` Calculado ${new Date(datos.calculadoEn).toLocaleString('es-CO', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}.` : ''}
            </Text>
          </div>
        </Group>
        <Group gap={6} wrap='nowrap'>
          {datos && datos.empresas.length > 1 && (
            <Select
              size='xs'
              w={200}
              value={empresa}
              onChange={(v) => {
                setEmpresa(v);
                void cargar(v);
              }}
              data={datos.empresas.map((e) => ({ value: String(e.idCompany), label: e.nombre }))}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
          )}
          <Tooltip label='Volver a calcular'>
            <ActionIcon variant='subtle' onClick={() => void cargar(empresa, true)} loading={cargando} aria-label='Volver a calcular'>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant='subtle' onClick={() => setAbierto((a) => !a)} aria-label={abierto ? 'Ocultar' : 'Mostrar'}>
            {abierto ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
        </Group>
      </Group>

      <Collapse in={abierto}>
        {error && (
          <Alert color='red' variant='light' mt='sm'>
            {error}
          </Alert>
        )}
        {!t ? (
          <Group justify='center' py='md'>
            <Loader size='sm' />
            <Text size='sm' c='dimmed'>
              Revisando los flujos de la empresa…
            </Text>
          </Group>
        ) : (
          <>
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing='xs' mt='sm'>
              <Cifra titulo='Flujos con movimiento' valor={`${t.flujosConMovimiento} de ${t.flujos}`} color='blue' />
              <Cifra titulo='Cuellos de botella' valor={String(t.cuellosDeBotella)} color={t.cuellosDeBotella > 0 ? 'red' : 'green'} ayuda='Tareas en rojo' />
              <Cifra titulo='Sugerencias por revisar' valor={String(t.pendientes)} color={t.pendientes > 0 ? 'yellow' : 'green'} />
              <Cifra titulo='Mejoras aplicadas' valor={String(t.aplicadas)} color='teal' />
              <Cifra
                titulo='Adopción'
                valor={t.adopcion === null ? '—' : `${t.adopcion} %`}
                color='teal'
                ayuda={`${t.aplicadas} aplicadas · ${t.descartadas} descartadas`}
              />
              <Cifra titulo='Tiempo ahorrado' valor={t.diasAhorrados > 0 ? textoDias(t.diasAhorrados) : '—'} color='green' ayuda='por solicitud, en las tareas mejoradas' />
            </SimpleGrid>

            {flujos.length === 0 ? (
              <Text size='sm' c='dimmed' mt='sm'>
                Ningún flujo de esta empresa tuvo solicitudes en los últimos 6 meses.
              </Text>
            ) : (
              <>
                <Table striped highlightOnHover mt='md' fz='sm' verticalSpacing={6}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Flujo (por prioridad)</Table.Th>
                      <Table.Th ta='right'>Solicitudes</Table.Th>
                      <Table.Th ta='right'>Duración normal</Table.Th>
                      <Table.Th>Semáforo</Table.Th>
                      <Table.Th ta='right'>Por revisar</Table.Th>
                      <Table.Th ta='right'>Aplicadas</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibles.map((f) => (
                      <Table.Tr key={f.idProcessCategory}>
                        <Table.Td>
                          <Anchor component={Link} href={`/process/request-general/view-workflows?id=${f.idProcessCategory}&from=${from}`} size='sm'>
                            {f.nombre}
                          </Anchor>
                        </Table.Td>
                        <Table.Td ta='right'>{f.solicitudes.toLocaleString('es-CO')}</Table.Td>
                        <Table.Td ta='right'>{textoDias(f.cicloMedianaDias)}</Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap='nowrap'>
                            {f.rojas > 0 && (
                              <Badge size='sm' color='red' variant='light'>
                                {f.rojas} {f.rojas === 1 ? 'cuello' : 'cuellos'}
                              </Badge>
                            )}
                            {f.amarillas > 0 && (
                              <Badge size='sm' color='yellow' variant='light'>
                                {f.amarillas} se {f.amarillas === 1 ? 'demora' : 'demoran'}
                              </Badge>
                            )}
                            {f.rojas === 0 && f.amarillas === 0 && (
                              <Badge size='sm' color='green' variant='light'>
                                Fluye bien
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td ta='right'>
                          {f.pendientes > 0 ? (
                            <Badge size='sm' color='teal' variant='filled'>
                              {f.pendientes}
                            </Badge>
                          ) : (
                            '—'
                          )}
                        </Table.Td>
                        <Table.Td ta='right'>
                          {f.aplicadas > 0 ? `${f.aplicadas}${f.diasAhorrados > 0 ? ` · −${textoDias(f.diasAhorrados)}` : ''}` : '—'}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {flujos.length > MAX_FILAS && (
                  <Anchor component='button' type='button' size='xs' mt='xs' onClick={() => setTodos((v) => !v)}>
                    {todos ? 'Ver menos' : `Ver los ${flujos.length} flujos`}
                  </Anchor>
                )}
              </>
            )}
          </>
        )}
      </Collapse>
    </Card>
  );
}

function Cifra({ titulo, valor, color, ayuda }: { titulo: string; valor: string; color: string; ayuda?: string }) {
  return (
    <Card p='sm' radius='md' withBorder style={{ backgroundColor: `var(--mantine-color-${color}-light)` }}>
      <Text size='xs' c={`${color}.7`}>
        {titulo}
      </Text>
      <Text size='lg' fw={700}>
        {valor}
      </Text>
      {ayuda && (
        <Text size='xs' c='dimmed' lineClamp={1}>
          {ayuda}
        </Text>
      )}
    </Card>
  );
}
