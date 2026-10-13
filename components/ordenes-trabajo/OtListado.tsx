'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Box, Button, Card, Group, Loader, SimpleGrid, Stack, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCheck, IconChevronRight, IconPlus, IconSearch, IconSettings } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { OT_BASE_URL, OT_DIAS_CERRADAS } from '../../lib/ordenes-trabajo/constants';
import type { OrdenResumen } from '../../lib/ordenes-trabajo/db';
import type { OtCompanyAccess } from '../../lib/ordenes-trabajo/rules';
import NuevaOrdenModal from './NuevaOrdenModal';
import { codigoOt, fmtFechaHora, haceCuanto, otHref, turnoLabel, useOtFetch } from './otClient';

/**
 * Listado (pantalla 1). Celular primero: tarjetas grandes de las órdenes
 * ABIERTAS (una columna en el celular), buscador por lote/producto/OP y las
 * CERRADAS de los últimos 30 días (tarjetas en el celular, tabla en escritorio).
 * El botón «Nueva orden de trabajo» (solo Gestión) queda fijo abajo en el celular.
 */
export default function OtListado({ company }: { company: OtCompanyAccess }) {
  const router = useRouter();
  const desktop = useMediaQuery('(min-width: 48em)') ?? false;
  const { data, error, loading } = useOtFetch<{ ordenes: OrdenResumen[] }>(`/api/ordenes-trabajo?company=${company.idCompany}`, 60_000);
  const [buscar, setBuscar] = useState('');
  const [nueva, setNueva] = useState(false);
  const [creada, setCreada] = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const all = data?.ordenes ?? [];
    const q = buscar.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) =>
      [o.lote, o.producto, o.itemCode ?? '', o.sapOpDocNum ? String(o.sapOpDocNum) : '', codigoOt(o.consecutivo)].some((v) => v.toLowerCase().includes(q))
    );
  }, [data, buscar]);
  const abiertas = filtradas.filter((o) => o.estado === 'ABIERTA');
  const cerradas = filtradas.filter((o) => o.estado === 'CERRADA');
  const ir = (o: OrdenResumen) => router.push(otHref(`${OT_BASE_URL}/${o.id}`, company.idCompany));

  return (
    <Stack gap='md' pb={company.canManage && !desktop ? 88 : 0}>
      {creada && (
        <Alert color='green' icon={<IconCheck size={18} />} withCloseButton onClose={() => setCreada(null)} data-testid='ot-creada'>
          {creada}
        </Alert>
      )}
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} data-testid='ot-listado-error'>
          {error}
        </Alert>
      )}

      {company.canManage && desktop && (
        <Group justify='flex-end' gap='sm'>
          <Button variant='default' size='md' leftSection={<IconSettings size={18} />} component={Link} href={otHref(`${OT_BASE_URL}/gestion`, company.idCompany)}>
            Catálogo de actividades
          </Button>
          <Button size='md' leftSection={<IconPlus size={18} />} onClick={() => setNueva(true)} data-testid='ot-nueva'>
            Nueva orden de trabajo
          </Button>
        </Group>
      )}

      <TextInput
        size='md'
        placeholder='Buscar por lote, producto, OP o número de orden'
        leftSection={<IconSearch size={18} />}
        value={buscar}
        onChange={(e) => setBuscar(e.currentTarget.value)}
        data-testid='ot-buscar'
      />

      <Title order={2} size='h3'>
        Abiertas <Badge variant='light' size='lg' ml={6}>{abiertas.length}</Badge>
      </Title>
      {loading && !data ? (
        <Group justify='center' py='lg'>
          <Loader />
        </Group>
      ) : abiertas.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>
            No hay órdenes de trabajo abiertas{buscar ? ' que coincidan' : ''}.
            {company.canManage ? ' Abra una con «Nueva orden de trabajo».' : ' El supervisor debe abrir la orden del turno.'}
          </Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='md'>
          {abiertas.map((o) => (
            <UnstyledButton key={o.id} onClick={() => ir(o)} style={{ display: 'block', width: '100%' }} data-testid='ot-abierta'>
              <Card withBorder shadow='sm' radius='md' p='md' h='100%'>
                <Group justify='space-between' wrap='nowrap' mb={6}>
                  <Text fw={700} size='lg'>{codigoOt(o.consecutivo)}</Text>
                  <Group gap={6} wrap='nowrap'>
                    <Badge color='green' variant='light' size='lg'>Abierta</Badge>
                    <IconChevronRight size={20} />
                  </Group>
                </Group>
                <Text fw={600} lineClamp={2}>{o.producto}</Text>
                <Text size='md' mt={4}>
                  Lote <b>{o.lote}</b> · Turno <b>{turnoLabel(o.turno)}</b>
                </Text>
                <Group gap={6} mt={8} wrap='wrap'>
                  {o.sapOpDocNum && <Badge variant='outline' size='md'>OP {o.sapOpDocNum}</Badge>}
                  {o.area && <Badge variant='outline' color='gray' size='md'>{o.area}</Badge>}
                  <Badge variant='light' color='blue' size='md'>{o.registros} registros</Badge>
                  {!company.canManage && !o.soyOperario && <Badge variant='light' color='yellow' size='md'>No figura como operario</Badge>}
                </Group>
                <Text size='sm' c='dimmed' mt={8}>
                  Abierta {haceCuanto(o.abiertaEn)} por {o.abiertaPor}
                </Text>
              </Card>
            </UnstyledButton>
          ))}
        </SimpleGrid>
      )}

      <Title order={2} size='h3' mt='md'>
        Cerradas (últimos {OT_DIAS_CERRADAS} días) <Badge variant='light' color='gray' size='lg' ml={6}>{cerradas.length}</Badge>
      </Title>
      {cerradas.length === 0 ? (
        <Text c='dimmed'>Sin órdenes cerradas{buscar ? ' que coincidan' : ''}.</Text>
      ) : desktop ? (
        <Card withBorder radius='md' p={0}>
          <Table striped highlightOnHover verticalSpacing='sm' data-testid='ot-cerradas'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Orden</Table.Th>
                <Table.Th>Producto</Table.Th>
                <Table.Th>Lote</Table.Th>
                <Table.Th>Turno</Table.Th>
                <Table.Th>OP</Table.Th>
                <Table.Th>Cerrada</Table.Th>
                <Table.Th>Registros</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cerradas.map((o) => (
                <Table.Tr key={o.id} onClick={() => ir(o)} style={{ cursor: 'pointer' }}>
                  <Table.Td fw={600}>{codigoOt(o.consecutivo)}</Table.Td>
                  <Table.Td>{o.producto}</Table.Td>
                  <Table.Td>{o.lote}</Table.Td>
                  <Table.Td>{turnoLabel(o.turno)}</Table.Td>
                  <Table.Td>{o.sapOpDocNum ?? '—'}</Table.Td>
                  <Table.Td>{fmtFechaHora(o.cerradaEn)}</Table.Td>
                  <Table.Td>{o.registros}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ) : (
        <Stack gap='sm' data-testid='ot-cerradas'>
          {cerradas.map((o) => (
            <UnstyledButton key={o.id} onClick={() => ir(o)} style={{ display: 'block', width: '100%' }}>
              <Card withBorder radius='md' p='md'>
                <Group justify='space-between' wrap='nowrap'>
                  <Text fw={700}>{codigoOt(o.consecutivo)}</Text>
                  <Badge color='gray' variant='light'>Cerrada</Badge>
                </Group>
                <Text fw={500} lineClamp={2}>{o.producto}</Text>
                <Text size='sm'>
                  Lote {o.lote} · {turnoLabel(o.turno)} · {o.registros} registros
                </Text>
                <Text size='sm' c='dimmed'>Cerrada {fmtFechaHora(o.cerradaEn)}</Text>
              </Card>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      {company.canManage && !desktop && (
        <Box pos='fixed' bottom={0} left={0} right={0} p='md' bg='var(--mantine-color-body)' style={{ borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 150 }}>
          <Group grow gap='sm'>
            <Button variant='default' size='md' h={52} component={Link} href={otHref(`${OT_BASE_URL}/gestion`, company.idCompany)} leftSection={<IconSettings size={18} />}>
              Catálogo
            </Button>
            <Button size='md' h={52} leftSection={<IconPlus size={18} />} onClick={() => setNueva(true)} data-testid='ot-nueva'>
              Nueva orden
            </Button>
          </Group>
        </Box>
      )}

      {company.canManage && (
        <NuevaOrdenModal
          opened={nueva}
          onClose={() => setNueva(false)}
          idCompany={company.idCompany}
          onCreated={(o) => {
            setNueva(false);
            const msg = `Orden ${codigoOt(o.consecutivo)} abierta.`;
            setCreada(msg);
            toast.success(msg);
            router.push(otHref(`${OT_BASE_URL}/${o.id}`, company.idCompany));
          }}
        />
      )}
    </Stack>
  );
}
