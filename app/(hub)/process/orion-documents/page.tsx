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
  IconFileCertificate,
  IconRefresh,
  IconSearch,
  IconTimeline,
  IconX,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import OrionDocumentLifecycleModal from '../../../../components/orion/OrionDocumentLifecycleModal';
import { ORION_REVIEW_STATUS_LABEL } from '../../../../lib/orion/reviewState';

type IndexedDocument = {
  id_request: number;
  file_id: string;
  file_name: string | null;
  orion_document_id: string | null;
  version_label: string | null;
  status: string | null;
  review_status: keyof typeof ORION_REVIEW_STATUS_LABEL | null;
  id_company: number | null;
  company_name: string | null;
  department_name: string | null;
  category_name: string | null;
  process_name: string | null;
  subject_request: string | null;
  signed_at: string | null;
  updated_at: string;
};

type ListResponse = {
  items: IndexedDocument[];
  total: number;
  companies: Array<{ id: number; name: string }>;
  departments: string[];
  isAdmin: boolean;
};

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
  return found ?? { value: '', label: status ? String(status) : 'Sin preparar', color: 'gray' };
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function OrionDocumentsPage() {
  const { status: sessionStatus } = useSession();
  const [company, setCompany] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [debouncedName] = useDebouncedValue(name, 350);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [lifecycle, setLifecycle] = useState<IndexedDocument | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (company) qs.set('company', company);
      if (department) qs.set('department', department);
      if (status) qs.set('status', status);
      if (debouncedName.trim()) qs.set('name', debouncedName.trim());
      const res = await fetch(`/api/integrations/orion/documents?${qs.toString()}`, {
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'No se pudieron cargar los documentos');
      setData(body as ListResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [company, department, status, debouncedName, page]);

  useEffect(() => {
    if (sessionStatus === 'authenticated') void load();
  }, [load, sessionStatus]);

  useEffect(() => {
    setPage(1);
  }, [company, department, status, debouncedName]);

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/integrations/orion/documents', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'No se pudo reconstruir el índice');
      toast.success(`Índice actualizado: ${body.documents ?? 0} documentos`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setReindexing(false);
    }
  };

  const hasFilters = Boolean(company || department || status || name.trim());
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Documentos firmados', href: '#' },
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
                <IconFileCertificate size={32} className='text-blue-600' />
                Documentos firmados
              </Title>
              <Text size='lg' c='dimmed'>
                Documentos de firma por empresa, departamento y estado
              </Text>
            </div>
            <Group gap='xs'>
              <Button
                variant='default'
                leftSection={<IconRefresh size={16} />}
                onClick={() => void load()}
                loading={loading && Boolean(data)}
              >
                Actualizar
              </Button>
              {data?.isAdmin ? (
                <Button variant='light' onClick={() => void reindex()} loading={reindexing}>
                  Reconstruir índice
                </Button>
              ) : null}
            </Group>
          </Flex>

          <Grid mb='md'>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <TextInput
                label='Nombre del documento'
                placeholder='Archivo o asunto'
                leftSection={<IconSearch size={16} />}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Select
                label='Empresa'
                placeholder='Todas'
                clearable
                searchable
                data={(data?.companies ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
                value={company}
                onChange={setCompany}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Select
                label='Departamento'
                placeholder='Todos'
                clearable
                searchable
                data={data?.departments ?? []}
                value={department}
                onChange={setDepartment}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Select
                label='Estado'
                placeholder='Todos'
                clearable
                data={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={status}
                onChange={setStatus}
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
                  setCompany(null);
                  setDepartment(null);
                  setStatus(null);
                  setName('');
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
            <Table.ScrollContainer minWidth={900}>
              <Table striped highlightOnHover verticalSpacing='sm'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Documento</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Departamento</Table.Th>
                    <Table.Th>Proceso</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Actualizado</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(data?.items ?? []).length === 0 && !loading ? (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text size='sm' c='dimmed' ta='center' py='lg'>
                          No hay documentos con estos filtros.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    (data?.items ?? []).map((doc) => {
                      const meta = statusMeta(doc.status);
                      return (
                        <Table.Tr key={`${doc.id_request}-${doc.file_id}`}>
                          <Table.Td style={{ maxWidth: 320 }}>
                            <Group gap={6} wrap='nowrap'>
                              <Text size='sm' fw={600} lineClamp={1} title={doc.file_name || ''}>
                                {doc.file_name || 'Documento'}
                              </Text>
                              {doc.version_label ? (
                                <Badge size='xs' variant='outline' color='violet'>
                                  {doc.version_label}
                                </Badge>
                              ) : null}
                            </Group>
                            <Text size='xs' c='dimmed' lineClamp={1}>
                              #{doc.id_request} · {doc.subject_request || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm'>{doc.company_name || '—'}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm' c='dimmed'>
                              {doc.department_name || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm' c='dimmed' lineClamp={2}>
                              {[doc.category_name, doc.process_name].filter(Boolean).join(' · ') || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4}>
                              <Badge variant='light' color={meta.color} size='sm'>
                                {meta.label}
                              </Badge>
                              {doc.review_status && doc.review_status !== 'SIN_VALIDACION' ? (
                                <Badge variant='outline' color='grape' size='xs'>
                                  {ORION_REVIEW_STATUS_LABEL[doc.review_status] ?? doc.review_status}
                                </Badge>
                              ) : null}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm' c='dimmed'>
                              {formatDate(doc.signed_at || doc.updated_at)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap='nowrap' justify='flex-end'>
                              <Tooltip label='Hoja de vida'>
                                <ActionIcon
                                  variant='subtle'
                                  color='violet'
                                  aria-label='Hoja de vida'
                                  onClick={() => setLifecycle(doc)}
                                >
                                  <IconTimeline size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label='Abrir solicitud'>
                                <ActionIcon
                                  variant='subtle'
                                  color='blue'
                                  aria-label='Abrir solicitud'
                                  component={Link}
                                  href={`/process/request-general/view-request?id=${doc.id_request}&orionFileId=${encodeURIComponent(doc.file_id)}`}
                                >
                                  <IconExternalLink size={16} />
                                </ActionIcon>
                              </Tooltip>
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

          {totalPages > 1 ? (
            <Group justify='space-between' mt='md'>
              <Text size='sm' c='dimmed'>
                {data?.total ?? 0} documentos
              </Text>
              <Pagination value={page} onChange={setPage} total={totalPages} size='sm' />
            </Group>
          ) : null}
        </Card>
      </div>

      {lifecycle ? (
        <OrionDocumentLifecycleModal
          opened
          onClose={() => setLifecycle(null)}
          requestId={lifecycle.id_request}
          fileId={lifecycle.file_id}
          fileName={lifecycle.file_name}
          versionLabel={lifecycle.version_label}
        />
      ) : null}
    </div>
  );
}
