'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Group, Loader, Table, Text, TextInput } from '@mantine/core';
import SgcSelect from '../../../../../components/sgc/SgcSelect';
import { IconAlertTriangle, IconBuildingCommunity, IconFileUpload, IconHierarchy2, IconSearch } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { SgcConfidentialityBadge, SgcDocumentCode, SgcReviewBadge, SgcStatusBadge } from '../../../../../components/sgc/SgcBadges';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { useSgcRowLink } from '../../../../../components/sgc/useSgcRowLink';
import { SGC_BASE_URL } from '../../../../../lib/sgc/constants';
import type { SgcCatalogs } from '../../../../../lib/sgc/db/catalogs';
import { filterMasterList, type SgcMasterItem } from '../../../../../lib/sgc/masterList';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * LISTADO MAESTRO del SGC: documentos que la persona puede consultar (para
 * todos menos Calidad, solo los vigentes), con buscador por código o título y
 * filtros por tipo de proceso, proceso y tipo documental. Código y versión
 * siempre visibles. Clic en la fila → ficha del documento.
 */

// Código, fechas y distintivos no se parten ni se recortan (la tabla se desplaza).
const NOWRAP = { whiteSpace: 'nowrap' } as const;
const NO_SHRINK = { flexShrink: 0, minWidth: 'max-content' } as const;

const STATUS_OPTIONS = [
  { value: 'vigente', label: 'Vigentes' },
  { value: 'obsoleto', label: 'Obsoletos' },
  { value: 'anulado', label: 'Anulados' },
  { value: 'todos', label: 'Todos los estados' },
];

function ListadoMaestro({ company }: { company: SgcCompanyAccess }) {
  const rowLink = useSgcRowLink();
  const [status, setStatus] = useState('vigente');
  const [q, setQ] = useState('');
  const [processTypeId, setProcessTypeId] = useState<string | null>(null);
  const [processId, setProcessId] = useState<string | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState<string | null>(null);

  const catalogs = useSgcFetch<SgcCatalogs>(`/api/sgc/catalogs?company=${company.idCompany}`);
  const docs = useSgcFetch<{ documents: SgcMasterItem[] }>(
    `/api/sgc/documents?company=${company.idCompany}${company.canQuality ? `&status=${status}` : ''}`
  );

  // Filtros iniciales desde la URL (?tipo=MA, ?q=...), p. ej. la tarjeta "Manuales".
  useEffect(() => {
    if (!catalogs.data) return;
    const params = new URLSearchParams(window.location.search);
    const tipo = params.get('tipo');
    if (tipo) {
      const match = catalogs.data.documentTypes.find((t) => t.code === tipo.toUpperCase());
      if (match) setDocumentTypeId(String(match.id));
    }
    const query = params.get('q');
    if (query) setQ(query);
  }, [catalogs.data]);

  const items = useMemo(
    () =>
      filterMasterList(docs.data?.documents ?? [], {
        q,
        processTypeId: processTypeId ? Number(processTypeId) : null,
        processId: processId ? Number(processId) : null,
        documentTypeId: documentTypeId ? Number(documentTypeId) : null,
      }),
    [docs.data, q, processTypeId, processId, documentTypeId]
  );

  const processOptions = (catalogs.data?.processes ?? [])
    .filter((p) => !processTypeId || p.idProcessType === Number(processTypeId))
    .map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }));

  return (
    <Card withBorder radius='md' p='lg' shadow='xs'>
      <Group gap='sm' mb='md' align='flex-end' wrap='wrap'>
        <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
          label='Buscar'
          placeholder='Código o título'
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={260}
          data-testid='sgc-buscador'
        />
        <SgcSelect
          label='Tipo de proceso'
          placeholder='Todos'
          clearable
          data={(catalogs.data?.processTypes ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
          value={processTypeId}
          onChange={(v) => {
            setProcessTypeId(v);
            setProcessId(null);
          }}
          w={220}
        />
        <SgcSelect
          label='Proceso'
          placeholder='Todos'
          clearable
          searchable
          data={processOptions}
          value={processId}
          onChange={setProcessId}
          w={260}
        />
        <SgcSelect
          label='Tipo documental'
          placeholder='Todos'
          clearable
          data={(catalogs.data?.documentTypes ?? []).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.pluralName}` }))}
          value={documentTypeId}
          onChange={setDocumentTypeId}
          w={220}
        />
        {company.canQuality && (
          <SgcSelect label='Estado' data={STATUS_OPTIONS} value={status} onChange={(v) => setStatus(v ?? 'vigente')} allowDeselect={false} w={180} />
        )}
      </Group>

      {(docs.error || catalogs.error) && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} mb='md'>
          {docs.error || catalogs.error}
        </Alert>
      )}

      <Group justify='space-between' mb='xs'>
        <Text size='sm' c='dimmed' data-testid='sgc-conteo'>
          {docs.loading ? 'Cargando…' : `${items.length} documento${items.length === 1 ? '' : 's'}`}
        </Text>
      </Group>

      {docs.loading && !docs.data ? (
        <Group justify='center' my='xl'>
          <Loader />
        </Group>
      ) : items.length === 0 ? (
        <Text c='dimmed' ta='center' my='xl' data-testid='sgc-listado-vacio'>
          {docs.data?.documents.length
            ? 'Ningún documento coincide con la búsqueda.'
            : 'Aún no hay documentos cargados que usted pueda consultar.'}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={1150}>
          <Table striped highlightOnHover verticalSpacing='sm' data-testid='sgc-listado'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Código · versión</Table.Th>
                <Table.Th>Título</Table.Th>
                <Table.Th>Tipo documental</Table.Th>
                <Table.Th>Proceso</Table.Th>
                <Table.Th>Vigente desde</Table.Th>
                <Table.Th>Revisión</Table.Th>
                <Table.Th>Acceso</Table.Th>
                {company.canQuality && <Table.Th>Estado</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((d) => (
                <Table.Tr
                  key={d.idDocument}
                  {...rowLink(sgcHref(`${SGC_BASE_URL}/documentos/${d.idDocument}`, company.idCompany))}
                  data-testid='sgc-fila-documento'
                >
                  <Table.Td style={NOWRAP}>
                    <SgcDocumentCode code={d.code} versionNumber={d.versionNumber} />
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm' fw={500}>
                      {d.title}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{d.documentType.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap='nowrap'>
                      <Badge color={d.processType.color} variant='light' size='xs' style={NO_SHRINK}>
                        {d.processType.name}
                      </Badge>
                      <Text size='sm'>{d.process.name}</Text>
                    </Group>
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

export default function ListadoMaestroPage() {
  return (
    <SgcShell
      section='Listado maestro'
      subtitle='Documentos controlados vigentes, con código y versión'
      actions={(company) => (
        <Group gap='xs'>
          <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/areas`, company.idCompany)} variant='light' leftSection={<IconBuildingCommunity size={16} />}>
            Por área
          </Button>
          <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/mapa`, company.idCompany)} variant='light' leftSection={<IconHierarchy2 size={16} />}>
            Mapa de documentos
          </Button>
          {company.canQuality && (
            <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/carga`, company.idCompany)} leftSection={<IconFileUpload size={16} />}>
              Cargar vigente
            </Button>
          )}
        </Group>
      )}
    >
      {(company) => <ListadoMaestro company={company} />}
    </SgcShell>
  );
}
