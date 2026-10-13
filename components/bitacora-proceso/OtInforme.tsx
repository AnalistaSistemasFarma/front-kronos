'use client';

import Link from 'next/link';
import { Alert, Anchor, Box, Breadcrumbs, Button, Card, Divider, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconArrowLeft, IconChevronRight, IconPrinter } from '@tabler/icons-react';
import { OT_BASE_URL, otNombreCompleto } from '../../lib/bitacora-proceso/constants';
import type { OrdenDetalle } from '../../lib/bitacora-proceso/db';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { codigoOt, fmtFecha, fmtFechaHora, fmtFechaHoraSeg, otHref, turnoLabel, useOtFetch } from './otClient';

/**
 * Informe de la bitácora (soporte de calidad, R9 P0): encabezado,
 * cronología y cierre. «Imprimir / Guardar PDF» usa el diálogo del navegador;
 * la hoja de impresión solo muestra el informe (en blanco y negro, sin menú).
 * En el celular la cronología va en tarjetas (sin desplazamiento lateral).
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  body * { visibility: hidden !important; }
  .ot-informe, .ot-informe * { visibility: visible !important; }
  .ot-informe { position: absolute; inset: 0 auto auto 0; width: 100%; color: #000 !important; background: #fff !important; }
  .ot-informe .mantine-Card-root, .ot-informe .mantine-Paper-root { box-shadow: none !important; background: #fff !important; border-color: #999 !important; }
  .ot-informe .mantine-Text-root, .ot-informe .mantine-Title-root, .ot-informe td, .ot-informe th { color: #000 !important; }
  .ot-no-print { display: none !important; }
  .ot-solo-impresion { display: block !important; }
  .ot-tabla-impresion { display: table !important; }
  .ot-tarjetas-pantalla { display: none !important; }
}`;

function Campo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>{label}</Text>
      <Text size='md' style={{ overflowWrap: 'anywhere' }}>{value || '—'}</Text>
    </div>
  );
}

export default function OtInforme({ company, idOrden }: { company: OtCompanyAccess; idOrden: number }) {
  const desktop = useMediaQuery('(min-width: 48em)') ?? false;
  const { data, error, loading } = useOtFetch<{ orden: OrdenDetalle }>(`/api/bitacora-proceso/${idOrden}?company=${company.idCompany}`);
  const o = data?.orden;

  if (loading && !o) {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }
  if (!o) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error ?? 'No se encontró la bitácora.'}
      </Alert>
    );
  }
  const op = o.sapOp as Record<string, unknown> | null;
  const opTxt = (k: string) => (op && op[k] != null ? String(op[k]) : null);

  return (
    <Stack gap='md' pb={desktop ? 0 : 88}>
      <style>{PRINT_CSS}</style>
      <Breadcrumbs separator={<IconChevronRight size={14} />} className='ot-no-print' style={{ flexWrap: 'wrap' }}>
        <Anchor component={Link} href='/process' size='sm'>Procesos</Anchor>
        <Anchor component={Link} href={otHref(OT_BASE_URL, company.idCompany)} size='sm'>Bitácora de Proceso</Anchor>
        <Anchor component={Link} href={otHref(`${OT_BASE_URL}/${o.id}`, company.idCompany)} size='sm'>{codigoOt(o.consecutivo)}</Anchor>
        <Text size='sm'>Informe</Text>
      </Breadcrumbs>

      {o.estado === 'ABIERTA' && (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />} className='ot-no-print'>
          La bitácora sigue abierta: este informe es parcial hasta el cierre.
        </Alert>
      )}

      <Card withBorder radius='md' p={{ base: 'md', sm: 'xl' }} className='ot-informe' data-testid='ot-informe-hoja'>
        <Stack gap='md'>
          <div>
            <Text size='sm' c='dimmed'>{company.companyName} · Registro de las intervenciones durante el proceso</Text>
            <Title order={1} size='h2'>
              {otNombreCompleto(company.companyName)}
            </Title>
            <Text fw={600}>Bitácora {codigoOt(o.consecutivo)}</Text>
            <Text size='sm' c='dimmed'>
              Estado: {o.estado === 'ABIERTA' ? 'Abierta (parcial)' : 'Cerrada'} · Generado el {fmtFechaHora(new Date().toISOString())}
            </Text>
          </div>
          <Divider />
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing='md' verticalSpacing='sm'>
            <Campo label='Producto' value={o.producto} />
            <Campo label='Código del artículo' value={o.itemCode} />
            <Campo label='Lote' value={o.lote} />
            <Campo label='Turno' value={turnoLabel(o.turno)} />
            <Campo label='Área' value={o.area} />
            <Campo label='Orden de producción SAP' value={o.sapOpDocNum ? String(o.sapOpDocNum) : 'Sin OP'} />
            {op && <Campo label='Vencimiento del lote (SAP)' value={fmtFecha(opTxt('U_FecVen_lote'))} />}
            {op && <Campo label='Bodega (SAP)' value={opTxt('Warehouse')} />}
            {op && <Campo label='Cantidad planeada (SAP)' value={opTxt('PlannedQuantity')} />}
            <Campo label='Hora inicio' value={fmtFechaHoraSeg(o.abiertaEn)} />
            <Campo label='Hora final' value={o.cerradaEn ? fmtFechaHoraSeg(o.cerradaEn) : 'Pendiente (abierta)'} />
            <Campo label='Supervisor' value={o.abiertaPor} />
            <Campo label='Inspector' value={o.inspector?.name ?? '—'} />
            <Campo label='Auxiliares' value={o.operarios.map((p) => p.name).join(', ')} />
            {o.cerradaPor && <Campo label='Cerrada por' value={o.cerradaPor} />}
          </SimpleGrid>
          {o.observacionCierre && <Campo label='Observación de cierre' value={o.observacionCierre} />}
          <Divider />
          <Title order={2} size='h4'>Cronología de intervenciones ({o.registros.length})</Title>
          <Text size='xs' c='dimmed'>Fecha y hora del servidor (hora de Colombia). Los registros no se editan ni se borran.</Text>

          {o.registros.length === 0 ? (
            <Text c='dimmed'>Sin registros.</Text>
          ) : (
            <>
              <Table
                withTableBorder
                withColumnBorders
                verticalSpacing='xs'
                className='ot-tabla-impresion'
                style={{ display: desktop ? 'table' : 'none' }}
                data-testid='ot-informe-tabla'
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    <Table.Th>Fecha y hora</Table.Th>
                    <Table.Th>Actividad</Table.Th>
                    <Table.Th>Usuario</Table.Th>
                    <Table.Th>Observación</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {o.registros.map((r, i) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{i + 1}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtFechaHoraSeg(r.registradoEn)}</Table.Td>
                      <Table.Td>{r.actividad}</Table.Td>
                      <Table.Td>{r.usuario}</Table.Td>
                      <Table.Td style={{ overflowWrap: 'anywhere' }}>{r.observacion ?? ''}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {!desktop && (
                <Stack gap='xs' className='ot-tarjetas-pantalla'>
                  {o.registros.map((r, i) => (
                    <Card key={r.id} withBorder radius='md' p='sm'>
                      <Group justify='space-between' wrap='nowrap'>
                        <Text fw={600}>{i + 1}. {r.actividad}</Text>
                      </Group>
                      <Text size='sm'>{fmtFechaHoraSeg(r.registradoEn)} · {r.usuario}</Text>
                      {r.observacion && <Text size='sm' c='dimmed' style={{ overflowWrap: 'anywhere' }}>{r.observacion}</Text>}
                    </Card>
                  ))}
                </Stack>
              )}
            </>
          )}
          <Divider />
          <Text size='xs' c='dimmed'>
            SynerLink · Bitácora de Proceso · {codigoOt(o.consecutivo)} · Soporte generado desde el sistema; no requiere firma manuscrita en esta versión.
          </Text>
        </Stack>
      </Card>

      <Box
        className='ot-no-print'
        pos={desktop ? 'static' : 'fixed'}
        bottom={0}
        left={0}
        right={0}
        p={desktop ? 0 : 'md'}
        bg={desktop ? undefined : 'var(--mantine-color-body)'}
        style={desktop ? undefined : { borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 150 }}
      >
        <Group grow={!desktop} justify='flex-end' gap='sm'>
          <Button variant='default' size={desktop ? 'lg' : 'md'} h={desktop ? undefined : 52} leftSection={<IconArrowLeft size={18} />} component={Link} href={otHref(`${OT_BASE_URL}/${o.id}`, company.idCompany)}>
            Volver
          </Button>
          <Button size={desktop ? 'lg' : 'md'} h={desktop ? undefined : 52} leftSection={<IconPrinter size={18} />} onClick={() => window.print()} data-testid='ot-imprimir'>
            {desktop ? 'Imprimir / PDF' : 'Imprimir'}
          </Button>
        </Group>
      </Box>
    </Stack>
  );
}
