'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
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
  IconFileDescription,
  IconChevronRight,
  IconFilter,
  IconX,
  IconDownload,
  IconLock,
  IconRefresh,
  IconFiles,
  IconCircleCheck,
  IconLink,
  IconSitemap,
  IconCategory,
  IconEdit,
} from '@tabler/icons-react';

/**
 * Sprint 7 — "Generador de Documentos"
 * (/process/document-management/generador).
 *
 * Muestra TODOS los documentos en estado "Vigente" (ya autorizados/
 * publicados por el flujo de 14 estados del Sprint 6, o cargados directo en
 * Fase 1). Reusa el mismo patrón visual de /process/document-management y
 * /process/request-general/general-requests: tarjetas resumen clicables,
 * card de filtros colapsable, tabla striped paginada en cliente.
 *
 * Para cada documento se indica si está o no ligado a un PROCESO
 * (`id_process`). Para los que NO tienen proceso se habilita
 * descargar/copiar enlace del archivo, SIEMPRE como PDF no editable (ver
 * app/api/document-management/documents/[id]/versions/[versionId]/pdf/route.ts).
 * Los documentos CON proceso solo muestran a cuál pertenecen — su vista
 * dedicada por categoría (Auditorías, No Conformidades, Ingeniería
 * Biomédica) es el Sprint 9, fuera de alcance aquí.
 */

const ITEMS_PER_PAGE = 25;

type ProcessFilter = 'all' | 'sin-proceso' | 'con-proceso';

// Fix pedido por Nicolás (2026-09-02): el Generador ya no reusa
// DocumentManagementCompanyAccess (lectura/escritura/atajo regulatorio del
// módulo general) -- tiene su PROPIO subproceso independiente
// ('/process/document-management/generador', ver
// lib/document-management/access.ts::getDocumentGeneratorAccess), así que
// aquí solo hace falta el par empresa/nombre.
interface CompanyAccess {
  idCompany: number;
  companyName: string;
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
  is_restricted: boolean;
  updated_at: string;
  id_process: number | null;
  processName: string | null;
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

export default function DocumentGeneratorPage() {
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
  const [processFilter, setProcessFilter] = useState<ProcessFilter>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [genRes, typesRes] = await Promise.all([
        fetch('/api/document-management/generator'),
        fetch('/api/document-management/types'),
      ]);
      if (!genRes.ok) throw new Error('No se pudieron cargar los documentos vigentes');
      const genData = await genRes.json();
      setCompanies(genData.companies ?? []);
      setDocuments(genData.documents ?? []);

      if (typesRes.ok) {
        const typesData = await typesRes.json();
        setTypes(typesData.types ?? []);
      }

      if ((genData.companies ?? []).length === 0) {
        setError('No tiene acceso al Generador de Documentos en ninguna empresa.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCompany, selectedType, processFilter]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return documents.filter((d) => {
      if (selectedCompany !== 'all' && String(d.company.id_company) !== selectedCompany) return false;
      if (selectedType !== 'all' && String(d.documentType?.id_document_type) !== selectedType) return false;

      if (processFilter === 'sin-proceso' && d.id_process != null) return false;
      if (processFilter === 'con-proceso' && d.id_process == null) return false;

      if (!term) return true;
      return [d.code, d.title, d.documentType?.name, d.owner?.name, d.owner?.email, d.processName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [documents, searchTerm, selectedCompany, selectedType, processFilter]);

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

  const totalCount = documents.length;
  const sinProcesoCount = documents.filter((d) => d.id_process == null).length;
  const conProcesoCount = documents.filter((d) => d.id_process != null).length;
  const restringidoCount = documents.filter((d) => d.is_restricted).length;

  const copyPdfLink = (documentId: number, versionId: number) => {
    const url = `${window.location.origin}/api/document-management/documents/${documentId}/versions/${versionId}/pdf`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopyFeedback('Enlace del PDF copiado — péguelo en un correo o chat para enviarlo.');
        setTimeout(() => setCopyFeedback(null), 4000);
      })
      .catch(() => {
        setCopyFeedback('No se pudo copiar el enlace. Use el botón de descarga.');
        setTimeout(() => setCopyFeedback(null), 4000);
      });
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Gestión Documental', href: '/process/document-management' },
    { title: 'Generador de Documentos', href: '#' },
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
      <Alert color="red" title="Generador de Documentos" mt="md">
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
                Generador de Documentos
              </Title>
              <Text size="lg" c="dimmed">
                Documentos ya autorizados (Vigentes), listos para descargar o enviar en PDF
              </Text>
            </div>
            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconCategory size={16} />}
                component={Link}
                href="/process/document-management/categorias"
              >
                Categorías de Proceso
              </Button>
              <Button
                variant="default"
                leftSection={<IconFileDescription size={16} />}
                component={Link}
                href="/process/document-management"
              >
                Gestión Documental
              </Button>
            </Group>
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card
                p="md"
                radius="md"
                withBorder
                role="button"
                aria-label="Mostrar todos los documentos vigentes"
                onClick={() => setProcessFilter('all')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-blue-light)',
                  borderColor:
                    processFilter === 'all' ? 'var(--mantine-color-blue-filled)' : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconFiles size={24} color="var(--mantine-color-blue-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-blue-light-color)">
                      Total Vigentes
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
                aria-label="Filtrar documentos sin proceso"
                onClick={() => setProcessFilter('sin-proceso')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-green-light)',
                  borderColor:
                    processFilter === 'sin-proceso'
                      ? 'var(--mantine-color-green-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconCircleCheck size={24} color="var(--mantine-color-green-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-green-light-color)">
                      Sin proceso (descargables)
                    </Text>
                    <Text size="lg" fw={600}>
                      {sinProcesoCount}
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
                aria-label="Filtrar documentos con proceso"
                onClick={() => setProcessFilter('con-proceso')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-orange-light)',
                  borderColor:
                    processFilter === 'con-proceso'
                      ? 'var(--mantine-color-orange-filled)'
                      : 'transparent',
                  borderWidth: 2,
                  transition: 'border-color 150ms ease',
                }}
              >
                <Group>
                  <IconSitemap size={24} color="var(--mantine-color-orange-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-orange-light-color)">
                      Con proceso
                    </Text>
                    <Text size="lg" fw={600}>
                      {conProcesoCount}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p="md" radius="md" withBorder style={{ backgroundColor: 'var(--mantine-color-gray-light)' }}>
                <Group>
                  <IconLock size={24} color="var(--mantine-color-gray-light-color)" />
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
            placeholder="Buscar por código, título, tipo, elaborador o proceso"
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
                    label="Proceso"
                    data={[
                      { value: 'all', label: 'Todos' },
                      { value: 'sin-proceso', label: 'Sin proceso' },
                      { value: 'con-proceso', label: 'Con proceso' },
                    ]}
                    value={processFilter}
                    onChange={(v) => setProcessFilter((v as ProcessFilter) ?? 'all')}
                    allowDeselect={false}
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
                    setProcessFilter('all');
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
            Documentos Vigentes
          </Title>

          {copyFeedback && (
            <Alert color="green" variant="light" mb="md" onClose={() => setCopyFeedback(null)} withCloseButton>
              {copyFeedback}
            </Alert>
          )}

          <Table.ScrollContainer minWidth={1200}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Código</Table.Th>
                  <Table.Th>Documento</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Proceso</Table.Th>
                  <Table.Th>Versión</Table.Th>
                  <Table.Th>Elaborador</Table.Th>
                  <Table.Th>Actualizado</Table.Th>
                  <Table.Th>Descargar / Enviar</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageItems.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={8} style={{ textAlign: 'center' }} className="py-12">
                      <Stack align="center" gap={4}>
                        <IconFileDescription size={40} className="text-gray-300" />
                        <Text size="sm" c="dimmed">
                          Sin documentos vigentes para mostrar con los filtros actuales.
                        </Text>
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  pageItems.map((d) => {
                    const latestVersion = d.versions[0];
                    const withoutProcess = d.id_process == null;
                    return (
                      <Table.Tr
                        key={d.id_document}
                        onClick={() =>
                          router.push(`/process/document-management/generador/${d.id_document}/editar`)
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          <Group gap={4} wrap="nowrap">
                            <Anchor
                              component={Link}
                              href={`/process/document-management/${d.id_document}`}
                              size="sm"
                              fw={600}
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
                          {withoutProcess ? (
                            <Badge color="gray" variant="light">
                              Sin proceso
                            </Badge>
                          ) : (
                            <Tooltip label={d.processName ?? `Proceso #${d.id_process}`}>
                              <Badge color="orange" variant="light" style={{ maxWidth: 180 }}>
                                <Text size="xs" truncate>
                                  {d.processName ?? `Proceso #${d.id_process}`}
                                </Text>
                              </Badge>
                            </Tooltip>
                          )}
                        </Table.Td>
                        <Table.Td>v{latestVersion?.version_number ?? '-'}</Table.Td>
                        <Table.Td>
                          <Text size="sm">{d.owner?.name || d.owner?.email || '-'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {formatDate(d.updated_at)}
                          </Text>
                        </Table.Td>
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          {withoutProcess && latestVersion?.onedrive_item_id ? (
                            <Group gap={4} wrap="nowrap">
                              <Tooltip label="Editar contenido y regenerar PDF">
                                <ActionIcon
                                  variant="light"
                                  color="violet"
                                  component={Link}
                                  href={`/process/document-management/generador/${d.id_document}/editar`}
                                  aria-label="Editar documento"
                                >
                                  <IconEdit size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Descargar / abrir como PDF">
                                <ActionIcon
                                  variant="light"
                                  color="blue"
                                  component="a"
                                  href={`/api/document-management/documents/${d.id_document}/versions/${latestVersion.id_document_version}/pdf`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label="Descargar PDF"
                                >
                                  <IconDownload size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Copiar enlace del PDF para enviar por correo/chat">
                                <ActionIcon
                                  variant="light"
                                  color="gray"
                                  onClick={() =>
                                    copyPdfLink(d.id_document, latestVersion.id_document_version)
                                  }
                                  aria-label="Copiar enlace para enviar"
                                >
                                  <IconLink size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          ) : (
                            <Text size="xs" c="dimmed">
                              {withoutProcess ? '-' : 'No disponible (documento de proceso)'}
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

