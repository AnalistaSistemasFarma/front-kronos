'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Box, Breadcrumbs, Button, Card, Divider, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconArrowLeft, IconChevronRight, IconPrinter, IconSquare, IconSquareCheck } from '@tabler/icons-react';
import { OT_BASE_URL, OT_INSPECTOR_LABEL, OT_JEFE_PRODUCCION_LABEL, OT_METODO_LABEL, OT_NOTA_CIERRE_JEFE, OT_ROL_APERTURA_CIERRE, OT_ROL_LABEL, OT_SIGNIFICADO_CIERRE_JEFE, otNombreCompleto } from '../../lib/bitacora-proceso/constants';
import type { OrdenDetalle } from '../../lib/bitacora-proceso/db';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { buildInformePrintCss, mmACm, parseMargenSuperiorCm } from '../../lib/bitacora-proceso/impresion';
import { OtMargenBatchCampo, useOtMargenBatch } from './OtMargenBatch';
import { codigoOt, fmtFecha, fmtFechaHora, fmtFechaHoraSeg, nombreArchivoInforme, otHref, turnoLabel, useOtFetch } from './otClient';

/**
 * Informe de la bitácora (soporte de calidad, R9 P0; se imprime para el batch
 * record): encabezado, cronología y, AL FINAL, los CUATRO vistos buenos (B2,
 * 2026-10-15: operario, supervisor «Cerró», inspector y jefe de producción) con
 * nombre, fecha y hora del servidor y cómo se confirmó. «Imprimir / Guardar PDF» usa el diálogo del navegador; la hoja de
 * impresión solo muestra el informe (en blanco y negro, sin menú).
 *   - A7: el bloque de verificación nunca se parte entre páginas (break-inside: avoid).
 *   - A8: el título del documento (nombre sugerido del PDF) es
 *     Bitacora_<código>_<lote>_<fecha>.
 *   - #8316 (2026-11-23): cada página deja arriba, en blanco, el espacio del encabezado del lote
 *     batch (margen configurable por empresa, 4 cm por defecto; se puede ajustar para una
 *     impresión). Las páginas se numeran en el pie. CSS en lib/bitacora-proceso/impresion.ts.
 * En el celular la cronología va en tarjetas (sin desplazamiento lateral).
 */

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
  // #8316: margen superior para el encabezado batch (empresa; ajustable solo para esta impresión).
  const margen = useOtMargenBatch(company.idCompany);
  const [margenCm, setMargenCm] = useState<number | null>(null);
  const margenEmpresaCm = mmACm(margen.margenMm);
  const margenMm = parseMargenSuperiorCm(margenCm ?? margenEmpresaCm) ?? margen.margenMm;
  const printCss = useMemo(
    () => buildInformePrintCss(margenMm, o ? `SynerLink · Bitácora ${codigoOt(o.consecutivo)} · Lote ${o.lote}` : 'SynerLink · Bitácora de Proceso'),
    [margenMm, o]
  );

  // A8: el navegador propone el título del documento como nombre del PDF.
  const titulo = o ? nombreArchivoInforme(o.consecutivo, o.lote, o.abiertaEn) : null;
  useEffect(() => {
    if (!titulo || typeof window === 'undefined') return;
    const anterior = document.title;
    const poner = () => {
      document.title = titulo;
    };
    poner();
    // Otros componentes del marco (p. ej. el título de estado del chat) pueden
    // reescribir el título: se vuelve a poner justo antes de imprimir (Ctrl+P incluido).
    window.addEventListener('beforeprint', poner);
    return () => {
      window.removeEventListener('beforeprint', poner);
      document.title = anterior;
    };
  }, [titulo]);

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
      <style>{printCss}</style>
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
              Estado: {o.estado === 'ABIERTA' ? 'Abierta (parcial)' : o.completa ? 'Cerrada, con todos los vistos buenos' : `Cerrada, falta el visto bueno del ${OT_ROL_LABEL[o.siguiente ?? 'JEFE_PROD'].toLowerCase()}`} · Generado el {fmtFechaHora(new Date().toISOString())}
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
            <Campo label='Abrió' value={`${o.abiertaPor} — ${OT_ROL_APERTURA_CIERRE[o.abiertaComo]} — ${fmtFechaHoraSeg(o.abiertaEn)}`} />
            {o.inspector && <Campo label={OT_INSPECTOR_LABEL} value={o.inspector.name} />}
            <Campo label={OT_JEFE_PRODUCCION_LABEL} value={o.jefe?.name ?? '—'} />
            <Campo
              label='Cerró'
              value={
                o.cierre
                  ? `${o.cierre.nombre} — ${OT_ROL_APERTURA_CIERRE[o.cierre.como]} — ${fmtFechaHoraSeg(o.cierre.en)} — ${OT_METODO_LABEL[o.cierre.metodo] ?? o.cierre.metodo}`
                  : o.cerradaPor ?? 'Pendiente (abierta)'
              }
            />
          </SimpleGrid>
          {o.cierre?.cuentaComoVistoJefe && <Text size='sm' fw={600} data-testid='ot-informe-cierre-jefe'>{OT_NOTA_CIERRE_JEFE}.</Text>}
          {o.operadores.length > 0 && <Campo label='Operarios' value={o.operadores.map((p) => p.nombre).join(', ')} />}
          {o.operarios.length > 0 && <Campo label='Auxiliares (con usuario)' value={o.operarios.map((p) => p.name).join(', ')} />}
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
                    <Table.Th w='5%'>#</Table.Th>
                    <Table.Th w='21%'>Fecha y hora</Table.Th>
                    <Table.Th w='23%'>Actividad</Table.Th>
                    <Table.Th w='17%'>Operario</Table.Th>
                    <Table.Th w='14%'>Registró (sesión)</Table.Th>
                    <Table.Th w='20%'>Observación / texto libre</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {o.registros.map((r, i) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{i + 1}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtFechaHoraSeg(r.registradoEn)}</Table.Td>
                      <Table.Td>{r.actividad}</Table.Td>
                      <Table.Td>{r.operador ?? '—'}</Table.Td>
                      <Table.Td>{r.usuario}</Table.Td>
                      <Table.Td style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                        {r.textoLibre ? <><b>Texto libre:</b> {r.observacion}</> : (r.observacion ?? '')}
                      </Table.Td>
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
                      <Text size='sm'>{fmtFechaHoraSeg(r.registradoEn)} · {r.operador ?? r.usuario}</Text>
                      {r.operador && <Text size='xs' c='dimmed'>Registró: {r.usuario}</Text>}
                      {r.observacion && (
                        <Text size='sm' c={r.textoLibre ? undefined : 'dimmed'} style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                          {r.textoLibre ? <><b>Texto libre:</b> {r.observacion}</> : r.observacion}
                        </Text>
                      )}
                    </Card>
                  ))}
                </Stack>
              )}
            </>
          )}
          <Divider />
          {/* A7/B2: los cuatro vistos buenos AL FINAL, en un bloque que no se parte entre páginas. */}
          <div className='ot-bloque-final' data-testid='ot-informe-firmas'>
            <Title order={2} size='h4' mb='sm'>Vistos buenos</Title>
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='md' className='ot-vistos-grid'>
              {o.vistos.map((v) => {
                const Icono = v.estado === 'dado' ? IconSquareCheck : IconSquare;
                return (
                  <Card key={v.rol} withBorder radius='md' p='sm' data-testid={`ot-informe-visto-${v.rol.toLowerCase()}`}>
                    <Group gap={8} wrap='nowrap' align='center'>
                      <Icono size={26} stroke={1.8} />
                      <div style={{ minWidth: 0 }}>
                        <Text fw={700}>{v.rol === 'SUPERVISOR' && v.firma?.significado === OT_SIGNIFICADO_CIERRE_JEFE ? OT_ROL_LABEL.JEFE_PROD : OT_ROL_LABEL[v.rol]}</Text>
                        {v.rol === 'SUPERVISOR' && <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Cerró la bitácora</Text>}
                      </div>
                    </Group>
                    {v.firma ? (
                      <>
                        <Text fw={600} mt={6}>{v.firma.nombre}</Text>
                        <Text size='sm'>{fmtFechaHoraSeg(v.firma.firmadoEn)}</Text>
                        <Text size='xs' c='dimmed'>Confirmado: {OT_METODO_LABEL[v.firma.metodo] ?? v.firma.metodo}</Text>
                      </>
                    ) : (
                      <Text c='dimmed' mt={6}>
                        {v.nota ?? (v.estado === 'no_aplica' ? 'No aplica' : `Pendiente${v.designado ? ` — ${v.designado}` : ''}`)}
                      </Text>
                    )}
                  </Card>
                );
              })}
            </SimpleGrid>
            <Text size='xs' c='dimmed' mt='md'>
              SynerLink · Bitácora de Proceso · {codigoOt(o.consecutivo)} · Soporte generado desde el sistema. Fechas y horas del servidor (hora de Colombia).
            </Text>
          </div>
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
        <Box mb='sm' data-testid='ot-margen-batch-panel'>
          <OtMargenBatchCampo
            company={company}
            valorCm={margenCm ?? margenEmpresaCm}
            onChange={setMargenCm}
            guardadoCm={margenEmpresaCm}
            onGuardado={async () => {
              await margen.reload(true);
              setMargenCm(null);
            }}
            description={`Espacio en blanco arriba de cada página para el encabezado del lote batch. Empresa: ${margenEmpresaCm} cm${company.canManage ? '' : ' (lo cambia el supervisor)'}.`}
          />
        </Box>
        <Group grow={!desktop} justify='flex-end' gap='sm'>
          <Button variant='default' size={desktop ? 'lg' : 'md'} h={desktop ? undefined : 52} leftSection={<IconArrowLeft size={18} />} component={Link} href={otHref(`${OT_BASE_URL}/${o.id}`, company.idCompany)}>
            Volver
          </Button>
          <Button size={desktop ? 'lg' : 'md'} h={desktop ? undefined : 52} leftSection={<IconPrinter size={18} />} onClick={() => {
              if (titulo) document.title = titulo;
              window.print();
            }} data-testid='ot-imprimir'>
            {desktop ? 'Imprimir / PDF' : 'Imprimir'}
          </Button>
        </Group>
      </Box>
    </Stack>
  );
}
