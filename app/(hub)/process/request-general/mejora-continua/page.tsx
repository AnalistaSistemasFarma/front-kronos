'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconChevronRight, IconEdit, IconTrendingUp } from '@tabler/icons-react';
import MejoraContinuaPanel, { BadgeSemaforo } from '../../../../../components/request-general/MejoraContinuaPanel';
import { CriterioCalificacion, EstadoFlujoBadge } from '../../../../../components/request-general/EstadoFlujo';
import type { Calificacion, Diagnostico, Sugerencia } from '../../../../../lib/workflow/mejora-continua-rules';
import { textoDias } from '../../../../../lib/workflow/mejora-continua-rules';

/**
 * PÁGINA DE MEJORA CONTINUA de un flujo (2026-11-09; Nicolás Rivera: «hazlo un botón que abra
 * otra página, ahí ya hay mucha información, se ve saturado»). El editor de flujos solo muestra
 * un botón con el estado; aquí van la calificación con sus motivos, la tendencia, las
 * sugerencias y cada tarea con su semáforo. «Aplicar» registra la decisión y abre el editor con
 * el cambio preparado. Diseño: docs/flujos-mejora-continua.md.
 */

interface FlujoDto {
  id: number;
  process: string;
  company: string;
  category: string | null;
}

function Contenido() {
  const router = useRouter();
  const sp = useSearchParams();
  const id = Number.parseInt(sp.get('id') ?? '', 10);
  const [flujo, setFlujo] = useState<FlujoDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<{ diagnostico: Diagnostico; calificacion: Calificacion | null } | null>(null);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setError('No se indicó el flujo.');
      return;
    }
    fetch(`/api/requests-general/mejora-continua/flujo?id=${id}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { flujo?: FlujoDto & Record<string, unknown>; error?: string } | null;
        if (!r.ok || !j?.flujo) throw new Error(j?.error || 'Flujo no encontrado.');
        setFlujo(j.flujo);
        // Para que «Abrir el flujo» abra ESTE flujo en el editor.
        sessionStorage.setItem('selectedRequest', JSON.stringify(j.flujo));
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const urlEditor = `/process/request-general/view-workflows?id=${id}&from=workflows`;
  const alDatos = useCallback((d: { diagnostico: Diagnostico; calificacion: Calificacion | null }) => setDatos(d), []);
  const abrirConCambio = (s: Sugerencia) => {
    const p = new URLSearchParams({ id: String(id), from: 'workflows', mejora: s.clave });
    router.push(`/process/request-general/view-workflows?${p}`);
  };

  return (
    <Stack gap='md' p='md' maw={1200} mx='auto'>
      <Breadcrumbs separator={<IconChevronRight size={16} />}>
        <Anchor component={Link} href='/process'>
          Procesos
        </Anchor>
        <Anchor component={Link} href='/process/request-general/admin-workflow'>
          Flujos de Trabajo
        </Anchor>
        <Text size='sm'>Mejora continua</Text>
      </Breadcrumbs>

      {error ? (
        <Alert color='red' variant='light'>
          {error}
        </Alert>
      ) : !flujo ? (
        <Group justify='center' py='xl'>
          <Loader size='sm' />
        </Group>
      ) : (
        <>
          <Card withBorder radius='md' p='lg'>
            <Group justify='space-between' align='flex-start' wrap='wrap' gap='sm'>
              <div>
                <Group gap='xs'>
                  <IconTrendingUp size={22} color='var(--mantine-color-teal-6)' />
                  <Title order={2}>Mejora continua · {flujo.process}</Title>
                </Group>
                <Text size='sm' c='dimmed'>
                  {flujo.company}
                  {flujo.category ? ` · ${flujo.category}` : ''}
                </Text>
              </div>
              <Group gap='xs'>
                <Button variant='default' leftSection={<IconArrowLeft size={16} />} component={Link} href='/process/request-general/admin-workflow'>
                  Flujos de trabajo
                </Button>
                <Button leftSection={<IconEdit size={16} />} component={Link} href={urlEditor}>
                  Abrir el flujo
                </Button>
              </Group>
            </Group>
            {datos?.calificacion && (
              <Stack gap={6} mt='md'>
                <Group gap='sm'>
                  <Text fw={600}>Estado del flujo:</Text>
                  <EstadoFlujoBadge calificacion={datos.calificacion} size='lg' />
                </Group>
                {datos.calificacion.motivos.map((m) => (
                  <Text key={m} size='sm'>
                    • {m}
                  </Text>
                ))}
                <CriterioCalificacion />
              </Stack>
            )}
          </Card>

          <MejoraContinuaPanel idProcessCategory={id} onAplicar={() => true} despuesDeAplicar={abrirConCambio} onDatos={alDatos} />

          {datos && datos.diagnostico.tareas.length > 0 && (
            <Card withBorder radius='md' p='lg'>
              <Text fw={700} mb='xs'>
                Tareas del flujo
              </Text>
              <Table striped highlightOnHover fz='sm'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Tarea</Table.Th>
                    <Table.Th>Semáforo</Table.Th>
                    <Table.Th ta='right'>Casos</Table.Th>
                    <Table.Th ta='right'>Lo normal</Table.Th>
                    <Table.Th ta='right'>Las más lentas</Table.Th>
                    <Table.Th ta='right'>Parte del tiempo</Table.Th>
                    <Table.Th ta='right'>Pendientes hoy</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {datos.diagnostico.tareas.map((t) => (
                    <Table.Tr key={t.idTarea}>
                      <Table.Td>{t.nombre}</Table.Td>
                      <Table.Td>
                        <BadgeSemaforo info={{ semaforo: t.semaforo, medianaDias: t.medianaDias, participacion: t.participacion, casos: t.casos }} />
                      </Table.Td>
                      <Table.Td ta='right'>{t.casos}</Table.Td>
                      <Table.Td ta='right'>{textoDias(t.medianaDias)}</Table.Td>
                      <Table.Td ta='right'>{textoDias(t.p90Dias)}</Table.Td>
                      <Table.Td ta='right'>{Math.round(t.participacion * 100)} %</Table.Td>
                      <Table.Td ta='right'>
                        {t.pendientes > 0 ? (
                          <Badge size='sm' variant='light' color='orange'>
                            {t.pendientes} · {textoDias(t.pendientesMedianaDias)}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </Stack>
  );
}

export default function MejoraContinuaPage() {
  return (
    <Suspense fallback={null}>
      <Contenido />
    </Suspense>
  );
}
