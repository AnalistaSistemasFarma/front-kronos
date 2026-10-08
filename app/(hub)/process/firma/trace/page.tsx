'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useDebouncedValue } from '@mantine/hooks';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  LoadingOverlay,
  MultiSelect,
  Pagination,
  Select,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronRight,
  IconExternalLink,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconTimeline,
  IconX,
} from '@tabler/icons-react';
import OrionTraceTimelineModal from '../../../../../components/orion/OrionTraceTimelineModal';
import type { OrionSearchDocument, OrionSearchResult } from '../../../../../lib/orion/client';

type Option = { id: number; name: string };

type FiltersResponse = {
  isAdmin: boolean;
  companies: Option[];
  categories: Option[];
  processes: Option[];
};

type SearchResponse = OrionSearchResult & { company: number | null; isAdmin: boolean };

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: string; label: string; color: string }> = [
  { value: 'BORRADOR', label: 'Borrador', color: 'gray' },
  { value: 'PENDIENTE_FIRMA', label: 'Pendiente de firma', color: 'blue' },
  { value: 'EN_PROCESO', label: 'En proceso', color: 'indigo' },
  { value: 'FIRMADO', label: 'Firmado', color: 'green' },
  { value: 'DEVUELTO', label: 'Devuelto', color: 'orange' },
  { value: 'RECHAZADO', label: 'Rechazado', color: 'red' },
];

function statusMeta(status?: string | null) {
  const found = STATUS_OPTIONS.find((o) => o.value === String(status || '').toUpperCase());
  return found ?? { value: '', label: status ? String(status) : '—', color: 'gray' };
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function nameOf(value: OrionSearchDocument['company'] | OrionSearchDocument['department']): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || '';
}

export default function OrionTracePage() {
  const { status: sessionStatus } = useSession();
  const [company, setCompany] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [processId, setProcessId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [debouncedQ] = useDebouncedValue(q, 400);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FiltersResponse | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrionSearchDocument | null>(null);

  const loadFilters = useCallback(async () => {
    const qs = new URLSearchParams();
    if (company) qs.set('company', company);
    if (category) qs.set('category', category);
    const res = await fetch(`/api/integrations/orion/trace/filters?${qs.toString()}`, {
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'No se pudieron cargar los filtros');
    const next = body as FiltersResponse;
    setFilters(next);
    if (!company && !next.isAdmin && next.companies.length > 0) {
      setCompany(String(next.companies[0].id));
    }
  }, [company, category]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (company) qs.set('company', company);
      if (category) qs.set('category', category);
      if (processId) qs.set('process', processId);
      if (statuses.length) qs.set('status', statuses.join(','));
      if (debouncedQ.trim()) qs.set('q', debouncedQ.trim());
      const res = await fetch(`/api/integrations/orion/trace?${qs.toString()}`, {
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'No se pudo consultar Orion');
      setData(body as SearchResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [company, category, processId, statuses, debouncedQ, page]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    loadFilters().catch((e) => setError(e instanceof Error ? e.message : 'Error'));
  }, [loadFilters, sessionStatus]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !filters) return;
    if (!filters.isAdmin && !company) return;
    void load();
  }, [load, sessionStatus, filters, company]);

  useEffect(() => {
    setPage(1);
  }, [company, category, processId, statuses, debouncedQ]);

  const changeCompany = (value: string | null) => {
    setCompany(value);
    setCategory(null);
    setProcessId(null);
  };

  const changeCategory = (value: string | null) => {
    setCategory(value);
    setProcessId(null);
  };

  const hasFilters = Boolean(category || processId || statuses.length || q.trim());
  const documents = data?.documents ?? [];
  const totalPages = Math.max(1, data?.totalPages ?? 1);

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Trazabilidad de documentos', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' size='sm'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component='span' size='sm' c='dimmed'>
        {item.title}
      </Text>
    )
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' wrap='wrap' gap='sm' mb='md'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3'>
                <IconRoute size={32} className='text-blue-600' />
                Trazabilidad de documentos
              </Title>
              <Text size='lg' c='dimmed'>
                Búsqueda en GSS Firma con la hoja de vida completa de cada documento
              </Text>
            </div>
            <Button
              variant='default'
              leftSection={<IconRefresh size={16} />}
              onClick={() => void load()}
              loading={loading && Boolean(data)}
            >
              Actualizar
            </Button>
          </Flex>

          <Grid mb='md'>
            <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
              <TextInput
                label='Nombre'
                placeholder='Título, proceso, consecutivo o n.º de solicitud'
                leftSection={<IconSearch size={16} />}
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
              <Select
                label='Empresa'
                placeholder={filters?.isAdmin ? 'Todas' : 'Seleccione'}
                clearable={Boolean(filters?.isAdmin)}
                searchable
                data={(filters?.companies ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
                value={company}
                onChange={changeCompany}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
              <MultiSelect
                label='Estado'
                placeholder={statuses.length ? undefined : 'Todos'}
                clearable
                data={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={statuses}
                onChange={setStatuses}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 6 }}>
              <Select
                label='Categoría'
                placeholder={company ? 'Todas' : 'Elija una empresa'}
                disabled={!company}
                clearable
                searchable
                data={(filters?.categories ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
                value={category}
                onChange={changeCategory}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 6 }}>
              <Select
                label='Proceso'
                placeholder={category ? 'Todos' : 'Elija una categoría'}
                disabled={!category}
                clearable
                searchable
                data={(filters?.processes ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
                value={processId}
                onChange={setProcessId}
              />
            </Grid.Col>
          </Grid>

          {hasFilters ? (
            <Group mb='sm'>
              <Button
                size='xs'
                variant='subtle'
                color='gray'
                leftSection={<IconX size={14} />}
                onClick={() => {
                  setCategory(null);
                  setProcessId(null);
                  setStatuses([]);
                  setQ('');
                }}
              >
                Limpiar filtros
              </Button>
            </Group>
          ) : null}

          {error ? (
            <Alert color='red' variant='light' mb='md'>
              {error}
            </Alert>
          ) : null}

          <Box pos='relative' mih={160}>
            <LoadingOverlay visible={loading} zIndex={5} overlayProps={{ blur: 1 }} />
            <Table.ScrollContainer minWidth={960}>
              <Table striped highlightOnHover verticalSpacing='sm'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Documento</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Categoría · Proceso</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Firmas</Table.Th>
                    <Table.Th>Creado</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {documents.length === 0 && !loading ? (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text size='sm' c='dimmed' ta='center' py='lg'>
                          No hay documentos con estos filtros.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    documents.map((doc) => {
                      const meta = statusMeta(doc.status);
                      const prov = doc.provenance ?? {};
                      const requestId = prov.synerlinkRequestId ?? null;
                      const signatures = doc.signatures;
                      return (
                        <Table.Tr key={doc.orionDocumentId}>
                          <Table.Td style={{ maxWidth: 320 }}>
                            <Group gap={6} wrap='nowrap'>
                              <Text size='sm' fw={600} lineClamp={1} title={doc.title || ''}>
                                {doc.title || 'Documento'}
                              </Text>
                              {prov.versionLabel ? (
                                <Badge size='xs' variant='outline' color='violet'>
                                  {prov.versionLabel}
                                </Badge>
                              ) : null}
                            </Group>
                            <Text size='xs' c='dimmed' lineClamp={1}>
                              {[
                                doc.documentNumber != null ? `N.º ${doc.documentNumber}` : null,
                                requestId ? `Solicitud #${requestId}` : null,
                                nameOf(doc.department) || null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm'>{prov.companyName || nameOf(doc.company) || '—'}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm' c='dimmed' lineClamp={2}>
                              {[prov.categoryName, prov.processName].filter(Boolean).join(' · ') ||
                                '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge variant='light' color={meta.color} size='sm'>
                              {meta.label}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            {signatures ? (
                              <Tooltip
                                disabled={!signatures.signers?.length}
                                multiline
                                w={260}
                                label={(signatures.signers ?? [])
                                  .map((s) => `${s.name || s.email}: ${s.status || '—'}`)
                                  .join('\n')}
                                style={{ whiteSpace: 'pre-line' }}
                              >
                                <Text size='sm'>
                                  {signatures.signed}/{signatures.required}
                                </Text>
                              </Tooltip>
                            ) : (
                              <Text size='sm' c='dimmed'>
                                —
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm' c='dimmed'>
                              {formatDate(doc.createdAt)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap='nowrap' justify='flex-end'>
                              <Tooltip label='Hoja de vida completa'>
                                <ActionIcon
                                  variant='subtle'
                                  color='violet'
                                  aria-label='Hoja de vida completa'
                                  onClick={() => setSelected(doc)}
                                >
                                  <IconTimeline size={16} />
                                </ActionIcon>
                              </Tooltip>
                              {requestId ? (
                                <Tooltip label='Abrir solicitud'>
                                  <ActionIcon
                                    variant='subtle'
                                    color='blue'
                                    aria-label='Abrir solicitud'
                                    component={Link}
                                    href={`/process/request-general/view-request?id=${requestId}${
                                      prov.fileId
                                        ? `&orionFileId=${encodeURIComponent(prov.fileId)}`
                                        : ''
                                    }`}
                                  >
                                    <IconExternalLink size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              ) : null}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          {data ? (
            <Group justify='space-between' mt='md'>
              <Text size='sm' c='dimmed'>
                {data.total ?? 0} documentos
              </Text>
              {totalPages > 1 ? (
                <Pagination value={page} onChange={setPage} total={totalPages} size='sm' />
              ) : null}
            </Group>
          ) : null}
        </Card>
      </div>

      {selected ? (
        <OrionTraceTimelineModal
          opened
          onClose={() => setSelected(null)}
          orionDocumentId={selected.orionDocumentId}
          requestId={selected.provenance?.synerlinkRequestId ?? null}
          fileId={selected.provenance?.fileId ?? null}
          title={selected.title}
        />
      ) : null}
    </div>
  );
}
