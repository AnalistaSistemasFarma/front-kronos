'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Loader,
  Alert,
  Table,
  TextInput,
  Select,
  Badge,
  Group,
  Button,
  Anchor,
  Card,
  Grid,
  Title,
  Text,
  Breadcrumbs,
  Collapse,
  Box,
  ActionIcon,
  Tooltip,
  Flex,
  Pagination,
  Stack,
  LoadingOverlay,
} from '@mantine/core';
import {
  IconSearch,
  IconPlus,
  IconListCheck,
  IconFileDescription,
  IconChevronRight,
  IconFilter,
  IconX,
  IconExternalLink,
  IconLock,
  IconRefresh,
  IconFiles,
  IconCircleCheck,
  IconProgress,
  IconLockSquare,
} from '@tabler/icons-react';
import CreateDocumentModal from './CreateDocumentModal';
import {
  isClosedState,
  DOCUMENT_WORKFLOW_STATES,
} from '../../../../lib/document-management/workflowStates';

/**
 * Gestión Documental — listado de documentos (Fase 1: carga inicial directo
 * en "Vigente"; Fase 2: agrega el flujo de aprobación de 14 estados, ver
 * /process/document-management/[id] y /process/document-management/mis-tareas).
 *
 * Consolida los documentos de TODAS las empresas a las que el usuario tiene
 * acceso de lectura, con el mismo patrón multiempresa de Registros
 * Sanitarios: dos endpoints propios (/api/document-management/access y
 * /api/document-management/documents) que resuelven el permiso en el
 * servidor.
 *
 * Visual: reusa el mismo patrón de tabla/filtros de
 * /process/request-general/general-requests (tarjetas resumen clicables,
 * card de filtros colapsable, tabla striped con paginación en cliente) — a
 * pedido explícito de Nicolás ("la tabla que tenemos aquí me gusta mucho").
 *
 * Sprint 5 (2026-09-02): la creación de un documento NUEVO ahora tiene dos
 * caminos (ver lib/document-management/documents.ts y
 * app/api/document-management/create-request/route.ts para el detalle):
 *   1. El camino estándar es el flujo normal de "crear solicitud" de
 *      SynerLink, seleccionando la categoría/proceso "Gestión Documental" —
 *      disponible para cualquier usuario, no vive en esta pantalla.
 *   2. El botón "Cargar documento" de abajo es el atajo de Asuntos
 *      Regulatorios: crea el documento directo, sin pasar por el formulario
 *      largo de "crear solicitud", pero termina en la MISMA estructura de
 *      datos. Por eso ahora se gatea por `canUploadDirect` (permiso NUEVO
 *      `/process/document-management/manage/regulatory`) y no por
 *      `canWrite` (que sigue siendo el permiso de las acciones del flujo de
 *      aprobación — revisar/aprobar/etc., ver [id]/TransitionActions.tsx).
 */

const ITEMS_PER_PAGE = 25;

function statusColor(status: string): string {
  if (status === 'Vigente') return 'green';
  if (isClosedState(status)) return 'red';
  if (status === 'Reasignación' || status === 'Reelaboración') return 'yellow';
  return 'blue';
}

type QuickFilter = 'all' | 'vigente' | 'en-tramite' | 'restringido';

interface CompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  canUploadDirect: boolean;
}

interface DocumentVersionSummary {
  id_document_version: number;
  version_number: number;
  status: string;
  onedrive_path: string;
  onedrive_item_id: string | null;
  created_at: string;
}

interface DocumentRow {
  id_document: number;
  code: string;
  title: string;
  current_status: string;
  due_review_date: string | null;
  is_restricted: boolean;
  updated_at: string;
  company: { id_company: number; company: string };
  documentType: { id_document_type: number; name: string };
  owner: { id: string; name: string | null; email: string };
  versions: DocumentVersionSummary[];
}

interface DocumentType {
  id_document_type: number;
  name: string;
  code_prefix: string;
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  const date = new Date(raw);
  if (isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export default function DocumentManagementPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedState, setSelectedState] = useState<string>('all');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [accessRes, typesRes] = await Promise.all([
        fetch('/api/document-management/access'),
        fetch('/api/document-management/types'),
      ]);
      if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al módulo');
      const accessData = await accessRes.json();
      const userCompanies: CompanyAccess[] = accessData.companies ?? [];
      setCompanies(userCompanies);

      if (typesRes.ok) {
        const typesData = await typesRes.json();
        setTypes(typesData.types ?? []);
      }

      if (userCompanies.length === 0) {
        setError('No tiene acceso a Gestión Documental en ninguna empresa.');
        return;
      }

      const listRes = await fetch('/api/document-management/documents');
      if (!listRes.ok) throw new Error('No se pudieron cargar los documentos');
      const listData = await listRes.json();
      setDocuments(listData.documents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCompany, selectedType, selectedState, quickFilter]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return documents.filter((d) => {
      if (selectedCompany !== 'all' && String(d.company.id_company) !== selectedCompany) return false;
      if (selectedType !== 'all' && String(d.documentType?.id_document_type) !== selectedType) return false;
      if (selectedState !== 'all' && d.current_status !== selectedState) return false;

      if (quickFilter === 'vigente' && d.current_status !== 'Vigente') return false;
      if (
        quickFilter === 'en-tramite' &&
        (d.current_status === 'Vigente' || isClosedState(d.current_status))
      )
        return false;
      if (quickFilter === 'restringido' && !d.is_restricted) return false;

      if (!term) return true;
      return [d.code, d.title, d.documentType?.name, d.owner?.name, d.owner?.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [documents, searchTerm, selectedCompany, selectedType, selectedState, quickFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const companyOptions = [
    { value: 'all', label: 'Todas las empresas' },
    ...companies.map((c) => ({ value: String(c.idCompany), label: c.companyName })),
  ];

  const typeOptions = [
    { value: 'all', label: 'Todos los tipos' },
    ...types.map((t) => ({ value: String(t.id_document_type), label: t.name })),
  ];

  const stateOptions = [
    { value: 'all', label: 'Todos los estados' },
    ...DOCUMENT_WORKFLOW_STATES.map((s) => ({ value: s, label: s })),
  ];

  // Sprint 5: el botón/modal "Cargar documento" (atajo directo) es de Asuntos
  // Regulatorios -- gateado por canUploadDirect, NO por canWrite (que ahora es
  // solo el permiso de las acciones del flujo de aprobación).
  const uploadDirectCompanies = companies
    .filter((c) => c.canUploadDirect)
    .map((c) => ({ idCompany: c.idCompany, companyName: c.companyName }));

  const totalCount = documents.length;
  const vigenteCount = documents.filter((d) => d.current_status === 'Vigente').length;
  const enTramiteCount = documents.filter(
    (d) => d.current_status !== 'Vigente' && !isClosedState(d.current_status)
  ).length;
  const restringidoCount = documents.filter((d) => d.is_restricted).length;

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Gestión Documental', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component="span" size="sm">
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component="span" size="sm" c="dimmed">
        {item.title}
      </Text>
    )
  );

  if (loading && documents.length === 0) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Gestión Documental" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Card shadow="sm" p="xl" radius="md" withBorder mb="6">
          <Breadcrumbs separator={<IconChevronRight size={16} />} className="mb-4">
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify="space-between" align="center" mb="4" wrap="wrap" gap="sm">
            <div>
              <Title order={1} className="text-3xl font-bold mb-2 flex items-center gap-3">
                <IconFileDescription size={32} className="text-blue-600" />
                Gestión Documental
              </Title>
              <Text size="lg" c="dimmed">
                Documentos vigentes y en trámite de aprobación
              </Text>
            </div>
            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconListCheck size={16} />}
                component={Link}
                href="/process/document-management/mis-tareas"
              >
                Mis tareas
              </Button>
              {uploadDirectCompanies.length > 0 && (
                <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
                  Cargar documento
                </Button>
              )}
            </Group>
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p="md"
                radius="md"
                withBorder
                role="button"
                aria-label="Mostrar todos los documentos"
                onClick={() => setQuickFilter('all')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-blue-light)',
                  borderColor:
                    quickFilter === 'all' ? 'var(--mantine-color-blue-filled)' : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconFiles size={24} color="var(--mantine-color-blue-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-blue-light-color)">
                      Total de Documentos
                    </Text>
                    <Text size="lg" fw={600}>
                      {totalCount}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p="md"
                radius="md"
                withBorder
                role="button"
                aria-label="Filtrar documentos vigentes"
                onClick={() => setQuickFilter('vigente')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-green-light)',
                  borderColor:
                    quickFilter === 'vigente' ? 'var(--mantine-color-green-filled)' : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconCircleCheck size={24} color="var(--mantine-color-green-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-green-light-color)">
                      Vigentes
                    </Text>
                    <Text size="lg" fw={600}>
                      {vigenteCount}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p="md"
                radius="md"
                withBorder
                role="button"
                aria-label="Filtrar documentos en trámite"
                onClick={() => setQuickFilter('en-tramite')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-orange-light)',
                  borderColor:
                    quickFilter === 'en-tramite'
                      ? 'var(--mantine-color-orange-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconProgress size={24} color="var(--mantine-color-orange-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-orange-light-color)">
                      En Trámite
                    </Text>
                    <Text size="lg" fw={600}>
                      {enTramiteCount}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p="md"
                radius="md"
                withBorder
                role="button"
                aria-label="Filtrar documentos restringidos"
                onClick={() => setQuickFilter('restringido')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-gray-light)',
                  borderColor:
                    quickFilter === 'restringido'
                      ? 'var(--mantine-color-gray-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconLockSquare size={24} color="var(--mantine-color-gray-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-gray-light-color)">
                      Restringidos
                    </Text>
                    <Text size="lg" fw={600}>
                      {restringidoCount}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
          </Grid>
        </Card>

        <CreateDocumentModal
          opened={createOpen}
          onClose={() => setCreateOpen(false)}
          companies={uploadDirectCompanies}
          types={types}
          onCreated={loadData}
        />

        <Card shadow="sm" p="lg" radius="md" withBorder mb="6">
          <Group justify="space-between" mb="md">
            <Title order={3} className="flex items-center gap-2">
              <IconFilter size={20} />
              Filtros de Búsqueda
            </Title>
            <ActionIcon
              variant="subtle"
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
            >
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <TextInput
            placeholder="Buscar por código, título, tipo o elaborador"
            leftSection={<IconSearch size={16} />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
            mb={filtersExpanded ? 'md' : 0}
          />

          <Collapse in={filtersExpanded}>
            <Box mt="md">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Select
                    label="Empresa"
                    data={companyOptions}
                    value={selectedCompany}
                    onChange={(v) => setSelectedCompany(v ?? 'all')}
                    allowDeselect={false}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Select
                    label="Tipo de documento"
                    data={typeOptions}
                    value={selectedType}
                    onChange={(v) => setSelectedType(v ?? 'all')}
                    allowDeselect={false}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Select
                    label="Estado del flujo"
                    data={stateOptions}
                    value={selectedState}
                    onChange={(v) => setSelectedState(v ?? 'all')}
                    allowDeselect={false}
                    searchable
                  />
                </Grid.Col>
              </Grid>

              <Group justify="flex-end" mt="md">
                <Button
                  variant="outline"
                  leftSection={<IconX size={16} />}
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCompany('all');
                    setSelectedType('all');
                    setSelectedState('all');
                    setQuickFilter('all');
                  }}
                >
                  Limpiar Filtros
                </Button>
                <Button leftSection={<IconRefresh size={16} />} onClick={loadData}>
                  Actualizar
                </Button>
              </Group>
            </Box>
          </Collapse>
        </Card>

        <Card shadow="sm" radius="md" withBorder className="overflow-hidden">
          <LoadingOverlay visible={loading} />

          <Title order={3} mb="md" className="flex items-center gap-2">
            <IconFileDescription size={20} />
            Lista de Documentos
          </Title>

          <Table.ScrollContainer minWidth={1100}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Código</Table.Th>
                  <Table.Th>Documento</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Versión</Table.Th>
                  <Table.Th>Elaborador</Table.Th>
                  <Table.Th>Próxima revisión</Table.Th>
                  <Table.Th>Actualizado</Table.Th>
                  <Table.Th>Archivo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageItems.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={9} style={{ textAlign: 'center' }} className="py-12">
                      <Stack align="center" gap={4}>
                        <IconFileDescription size={40} className="text-gray-300" />
                        <Text size="sm" c="dimmed">
                          Sin documentos para mostrar con los filtros actuales.
                        </Text>
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  pageItems.map((d) => {
                    const latestVersion = d.versions[0];
                    return (
                      <Table.Tr
                        key={d.id_document}
                        style={{ cursor: 'pointer' }}
                        onClick={() => router.push(`/process/document-management/${d.id_document}`)}
                      >
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Anchor
                              component={Link}
                              href={`/process/document-management/${d.id_document}`}
                              size="sm"
                              fw={600}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {d.code}
                            </Anchor>
                            {d.is_restricted && (
                              <Tooltip label="Documento restringido">
                                <IconLock size={13} className="text-gray-400" />
                              </Tooltip>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            {d.documentType?.name ?? '-'}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 220, maxWidth: 320 }}>
                          <Text size="sm" lineClamp={2}>
                            {d.title}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light">{d.company.company}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={statusColor(d.current_status)} variant="light">
                            {d.current_status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>v{latestVersion?.version_number ?? '-'}</Table.Td>
                        <Table.Td>
                          <Text size="sm">{d.owner?.name || d.owner?.email || '-'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {formatDate(d.due_review_date)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {formatDate(d.updated_at)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {latestVersion?.onedrive_item_id ? (
                            <Tooltip label="Abrir archivo en OneDrive">
                              <ActionIcon
                                variant="light"
                                color="blue"
                                component="a"
                                href={`/api/document-management/documents/${d.id_document}/versions/${latestVersion.id_document_version}/open`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Abrir archivo"
                              >
                                <IconExternalLink size={16} />
                              </ActionIcon>
                            </Tooltip>
                          ) : (
                            <Text size="xs" c="dimmed">
                              -
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Group justify="space-between" mt="md" wrap="wrap">
            <Text size="xs" c="dimmed">
              {filtered.length} documento(s) — {companies.length} empresa(s) con acceso
            </Text>
            {totalPages > 1 && (
              <Pagination total={totalPages} value={currentPage} onChange={setCurrentPage} />
            )}
          </Group>
        </Card>
      </div>
    </div>
  );
}
