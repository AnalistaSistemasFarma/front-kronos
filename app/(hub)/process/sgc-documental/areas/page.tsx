'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Grid, Group, Loader, Table, Text, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconBuildingCommunity, IconFolder, IconListDetails } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { SgcConfidentialityBadge, SgcDocumentCode, SgcReviewBadge, SgcStatusBadge } from '../../../../../components/sgc/SgcBadges';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { useSgcRowLink } from '../../../../../components/sgc/useSgcRowLink';
import { SGC_BASE_URL } from '../../../../../lib/sgc/constants';
import { documentsOfArea, groupByAreaAndType, type SgcMasterItem } from '../../../../../lib/sgc/masterList';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * DOCUMENTACIÓN POR ÁREA → TIPO DOCUMENTAL (pedida por Calidad OLP el
 * 2026-10-02): se entra por el área (departamento dueño del documento, p. ej.
 * Compras), luego por el tipo (manual, procedimiento, instructivo…) y se ve la
 * lista con código y versión. Es otra forma de recorrer el LISTADO MAESTRO
 * (que se conserva) y respeta los mismos permisos: solo aparece lo que la
 * persona puede consultar.
 */

const NOWRAP = { whiteSpace: 'nowrap' } as const;

function PorArea({ company }: { company: SgcCompanyAccess }) {
  const rowLink = useSgcRowLink();
  const docs = useSgcFetch<{ documents: SgcMasterItem[] }>(`/api/sgc/documents?company=${company.idCompany}`);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const groups = useMemo(() => groupByAreaAndType(docs.data?.documents ?? []), [docs.data]);

  // Permite enlazar directo a un área o tipo (?area=3&tipo=2).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const a = Number(params.get('area'));
    const t = Number(params.get('tipo'));
    if (params.has('area') && Number.isInteger(a)) setAreaId(a);
    if (Number.isInteger(t) && t > 0) setTypeId(t);
  }, []);

  if (docs.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {docs.error}
      </Alert>
    );
  }
  if (!docs.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  if (groups.length === 0) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />}>
        Aún no hay documentos cargados que usted pueda consultar.
      </Alert>
    );
  }
  const area = groups.find((g) => g.id === areaId) ?? null;
  const type = area?.types.find((t) => t.id === typeId) ?? null;
  const items = area ? documentsOfArea(docs.data.documents, area.id, type?.id ?? null) : [];

  return (
    <Card withBorder radius='md' p='lg' shadow='xs' data-testid='sgc-areas'>
      <Breadcrumbs mb='md'>
        <Anchor component='button' type='button' onClick={() => { setAreaId(null); setTypeId(null); }} data-testid='sgc-areas-inicio'>
          Documentación
        </Anchor>
        {area && (
          <Anchor component='button' type='button' onClick={() => setTypeId(null)}>
            {area.name}
          </Anchor>
        )}
        {type && <Text size='sm'>{type.pluralName}</Text>}
      </Breadcrumbs>

      {!area && (
        <Grid gutter='md'>
          {groups.map((g) => (
            <Grid.Col key={g.id} span={{ base: 12, sm: 6, md: 4 }}>
              <UnstyledButton onClick={() => { setAreaId(g.id); setTypeId(null); }} w='100%' data-testid='sgc-area'>
                <Card withBorder radius='md' p='md' shadow='xs' style={{ borderLeft: '6px solid var(--mantine-color-blue-6)' }}>
                  <Group justify='space-between' wrap='nowrap'>
                    <Group gap='xs' wrap='nowrap'>
                      <IconBuildingCommunity size={18} />
                      <Text fw={700} size='sm'>
                        {g.name}
                      </Text>
                    </Group>
                    <Badge variant='light'>{g.count}</Badge>
                  </Group>
                  <Text size='xs' c='dimmed' mt={6}>
                    {g.types.map((t) => `${t.pluralName} (${t.count})`).join(' · ')}
                  </Text>
                </Card>
              </UnstyledButton>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {area && !type && (
        <Grid gutter='md'>
          {area.types.map((t) => (
            <Grid.Col key={t.id} span={{ base: 12, sm: 6, md: 3 }}>
              <UnstyledButton onClick={() => setTypeId(t.id)} w='100%' data-testid='sgc-area-tipo'>
                <Card withBorder radius='md' p='md' shadow='xs'>
                  <Group justify='space-between' wrap='nowrap'>
                    <Group gap='xs' wrap='nowrap'>
                      <IconFolder size={18} className='text-yellow-6' />
                      <Text fw={600} size='sm'>
                        {t.pluralName}
                      </Text>
                    </Group>
                    <Badge variant='light' color='gray'>
                      {t.count}
                    </Badge>
                  </Group>
                  <Text size='xs' c='dimmed' ff='monospace' mt={4}>
                    {t.code}
                  </Text>
                </Card>
              </UnstyledButton>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {area && type && (
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing='sm' data-testid='sgc-area-documentos'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Código · versión</Table.Th>
                <Table.Th>Título</Table.Th>
                <Table.Th>Proceso</Table.Th>
                <Table.Th>Vigente desde</Table.Th>
                <Table.Th>Revisión</Table.Th>
                <Table.Th>Acceso</Table.Th>
                {company.canQuality && <Table.Th>Estado</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((d) => (
                <Table.Tr key={d.idDocument} {...rowLink(sgcHref(`${SGC_BASE_URL}/documentos/${d.idDocument}`, company.idCompany))} data-testid='sgc-fila-documento'>
                  <Table.Td style={NOWRAP}>
                    <SgcDocumentCode code={d.code} versionNumber={d.versionNumber} />
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm' fw={500}>
                      {d.title}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{d.process.name}</Text>
                  </Table.Td>
                  <Table.Td style={NOWRAP}>
                    <Text size='sm'>{d.effectiveDate ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td style={NOWRAP}>
                    <SgcReviewBadge reviewDueDate={d.reviewDueDate} alertMonths={d.documentType.alertMonths} />
                  </Table.Td>
                  <Table.Td style={NOWRAP}>
                    <SgcConfidentialityBadge value={d.confidentiality} />
                  </Table.Td>
                  {company.canQuality && (
                    <Table.Td style={NOWRAP}>
                      <SgcStatusBadge status={d.status} />
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

export default function DocumentosPorAreaPage() {
  return (
    <SgcShell
      section='Documentación por área'
      subtitle='Área → tipo documental (manual, procedimiento, instructivo…) → documento'
      actions={(company) => (
        <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/listado`, company.idCompany)} variant='light' leftSection={<IconListDetails size={16} />}>
          Listado maestro
        </Button>
      )}
    >
      {(company) => <PorArea company={company} />}
    </SgcShell>
  );
}
