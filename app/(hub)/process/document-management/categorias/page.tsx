'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  Box,
  Tooltip,
  Flex,
  Stack,
  LoadingOverlay,
  Tabs,
  Accordion,
} from '@mantine/core';
import {
  IconSearch,
  IconFileDescription,
  IconChevronRight,
  IconRefresh,
  IconCategory,
  IconCircleCheck,
  IconAlertTriangle,
  IconLock,
  IconTag,
  IconListDetails,
} from '@tabler/icons-react';

/**
 * Sprint 9 — "Categorías de Proceso Documental"
 * (/process/document-management/categorias).
 *
 * Muestra el catálogo completo de categorías de proceso de negocio
 * (Auditorías y Autoinspecciones / No Conformidades / Ingeniería Biomédica,
 * ver prisma/seeds/document-management-process-categories.sql) y, dentro de
 * cada categoría/sub-proceso, los documentos VIGENTES ya clasificados ahí —
 * cada uno enlaza al detalle existente (/process/document-management/[id])
 * que ya trae el historial completo de versiones, en vez de duplicarlo
 * aquí. También lista los documentos Vigentes SIN clasificar todavía, con
 * una acción para clasificarlos en un sub-proceso.
 *
 * Por qué esto NO es lo mismo que "Proceso" en /generador: ese campo
 * (`id_process`) identifica si el documento pasó por el flujo de
 * aprobación de 14 estados (motor de workflow), no a qué proceso de
 * NEGOCIO pertenece — ver el comentario de app/api/document-management/
 * process-categories/route.ts y el modelo Document en prisma/schema.prisma.
 */

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
  created_at: string;
}

interface DocumentRow {
  id_document: number;
  code: string;
  title: string;
  current_status: string;
  is_restricted: boolean;
  updated_at: string;
  company: { id_company: number; company: string };
  documentType: { id_document_type: number; name: string };
  owner: { id: string; name: string | null; email: string };
  versions: DocumentVersionSummary[];
}

interface SubprocessData {
  id: number;
  id_document_process_category: number;
  name: string;
  display_order: number;
  is_active: boolean;
  documents: DocumentRow[];
}

interface CategoryData {
  id: number;
  name: string;
  display_order: number;
  is_active: boolean;
  subprocesses: SubprocessData[];
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

function DocumentsTable({ documents }: { documents: DocumentRow[] }) {
  if (documents.length === 0) {
    return (
      <Text size="sm" c="dimmed" py="md" ta="center">
        Sin documentos vigentes clasificados aquí todavía.
      </Text>
    );
  }
  return (
    <Table.ScrollContainer minWidth={800}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Código</Table.Th>
            <Table.Th>Documento</Table.Th>
            <Table.Th>Empresa</Table.Th>
            <Table.Th>Versión vigente</Table.Th>
            <Table.Th>Elaborador</Table.Th>
            <Table.Th>Actualizado</Table.Th>
            <Table.Th>Historial</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {documents.map((d) => {
            const latestVersion = d.versions[0];
            return (
              <Table.Tr key={d.id_document}>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {d.code}
                    </Text>
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
                <Table.Td style={{ minWidth: 200, maxWidth: 320 }}>
                  <Text size="sm" lineClamp={2}>
                    {d.title}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{d.company.company}</Badge>
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
                <Table.Td>
                  <Anchor component={Link} href={`/process/document-management/${d.id_document}`} size="sm">
                    Ver historial de versiones
                  </Anchor>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export default function DocumentProcessCategoriesPage() {
  const { data: session } = useSession();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [unclassified, setUnclassified] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [classifying, setClassifying] = useState<Record<number, string | null>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/document-management/process-categories');
      if (!res.ok) throw new Error('No se pudo cargar el catálogo de categorías de proceso');
      const data = await res.json();
      setCompanies(data.companies ?? []);
      setCategories(data.categories ?? []);
      setUnclassified(data.unclassified ?? []);
      setActiveTab((prev) => prev ?? String(data.categories?.[0]?.id ?? 'sin-clasificar'));

      if ((data.companies ?? []).length === 0) {
        setError('No tiene acceso a Gestión Documental en ninguna empresa.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const canWriteAny = companies.some((c) => c.canWrite);

  const subprocessOptions = useMemo(
    () =>
      categories.flatMap((cat) => ({
        group: cat.name,
        items: cat.subprocesses.map((sp) => ({ value: String(sp.id), label: sp.name })),
      })),
    [categories]
  );

  const totalCategories = categories.length;
  const totalClassified = useMemo(
    () =>
      categories.reduce(
        (sum, cat) => sum + cat.subprocesses.reduce((s, sp) => s + sp.documents.length, 0),
        0
      ),
    [categories]
  );
  const totalUnclassified = unclassified.length;

  const term = searchTerm.trim().toLowerCase();
  const matchesTerm = (d: DocumentRow) =>
    !term ||
    [d.code, d.title, d.documentType?.name, d.owner?.name, d.owner?.email, d.company?.company]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term));

  const filteredCategories = useMemo(
    () =>
      categories.map((cat) => ({
        ...cat,
        subprocesses: cat.subprocesses.map((sp) => ({
          ...sp,
          documents: sp.documents.filter(matchesTerm),
        })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, term]
  );

  const filteredUnclassified = useMemo(
    () => unclassified.filter(matchesTerm),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unclassified, term]
  );

  const classifyDocument = async (documentId: number) => {
    const subprocessId = classifying[documentId];
    if (!subprocessId) {
      setFeedback({ type: 'error', message: 'Seleccione una categoría/sub-proceso antes de clasificar.' });
      return;
    }
    setSavingId(documentId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/document-management/documents/${documentId}/classify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subprocessId: Number(subprocessId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo clasificar el documento');
      setFeedback({ type: 'success', message: 'Documento clasificado correctamente.' });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error inesperado al clasificar',
      });
    } finally {
      setSavingId(null);
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Gestión Documental', href: '/process/document-management' },
    { title: 'Categorías de Proceso', href: '#' },
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

  if (loading && categories.length === 0 && unclassified.length === 0) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Categorías de Proceso Documental" mt="md">
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
                <IconCategory size={32} className="text-blue-600" />
                Categorías de Proceso Documental
              </Title>
              <Text size="lg" c="dimmed">
                Auditorías y Autoinspecciones, No Conformidades e Ingeniería Biomédica, con sus
                documentos vigentes organizados por sub-proceso
              </Text>
            </div>
            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconFileDescription size={16} />}
                component={Link}
                href="/process/document-management/generador"
              >
                Generador de Documentos
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
            <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
              <Card p="md" radius="md" withBorder style={{ backgroundColor: 'var(--mantine-color-blue-light)' }}>
                <Group>
                  <IconCategory size={24} color="var(--mantine-color-blue-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-blue-light-color)">
                      Categorías activas
                    </Text>
                    <Text size="lg" fw={600}>
                      {totalCategories}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
              <Card p="md" radius="md" withBorder style={{ backgroundColor: 'var(--mantine-color-green-light)' }}>
                <Group>
                  <IconCircleCheck size={24} color="var(--mantine-color-green-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-green-light-color)">
                      Documentos clasificados
                    </Text>
                    <Text size="lg" fw={600}>
                      {totalClassified}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
              <Card
                p="md"
                radius="md"
                withBorder
                role="button"
                aria-label="Ir a documentos sin clasificar"
                onClick={() => setActiveTab('sin-clasificar')}
                style={{
                  cursor: 'pointer',
                  backgroundColor: 'var(--mantine-color-orange-light)',
                  borderColor:
                    activeTab === 'sin-clasificar' ? 'var(--mantine-color-orange-filled)' : 'transparent',
                  borderWidth: 2,
                }}
              >
                <Group>
                  <IconAlertTriangle size={24} color="var(--mantine-color-orange-light-color)" />
                  <div>
                    <Text size="xs" c="var(--mantine-color-orange-light-color)">
                      Vigentes sin clasificar
                    </Text>
                    <Text size="lg" fw={600}>
                      {totalUnclassified}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
          </Grid>
        </Card>

        <Card shadow="sm" p="lg" radius="md" withBorder mb="6">
          <Group justify="space-between" mb="md" wrap="wrap">
            <TextInput
              placeholder="Buscar por código, título, empresa o elaborador"
              leftSection={<IconSearch size={16} />}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.currentTarget.value)}
              style={{ minWidth: 280, flex: 1 }}
            />
            <Button variant="outline" leftSection={<IconRefresh size={16} />} onClick={loadData}>
              Actualizar
            </Button>
          </Group>

          {feedback && (
            <Alert
              color={feedback.type === 'success' ? 'green' : 'red'}
              variant="light"
              mb="md"
              onClose={() => setFeedback(null)}
              withCloseButton
            >
              {feedback.message}
            </Alert>
          )}
        </Card>

        <Card shadow="sm" radius="md" withBorder className="overflow-hidden">
          <LoadingOverlay visible={loading} />

          <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
            <Tabs.List>
              {filteredCategories.map((cat) => (
                <Tabs.Tab key={cat.id} value={String(cat.id)} leftSection={<IconListDetails size={14} />}>
                  {cat.name} (
                  {cat.subprocesses.reduce((s, sp) => s + sp.documents.length, 0)})
                </Tabs.Tab>
              ))}
              <Tabs.Tab
                value="sin-clasificar"
                leftSection={<IconAlertTriangle size={14} />}
                color="orange"
              >
                Sin clasificar ({filteredUnclassified.length})
              </Tabs.Tab>
            </Tabs.List>

            {filteredCategories.map((cat) => (
              <Tabs.Panel key={cat.id} value={String(cat.id)} pt="md">
                <Accordion multiple defaultValue={cat.subprocesses.map((sp) => String(sp.id))}>
                  {cat.subprocesses.map((sp) => (
                    <Accordion.Item key={sp.id} value={String(sp.id)}>
                      <Accordion.Control icon={<IconTag size={16} />}>
                        <Group justify="space-between" pr="md">
                          <Text fw={500}>{sp.name}</Text>
                          <Badge variant="light" color="gray">
                            {sp.documents.length} documento(s)
                          </Badge>
                        </Group>
                      </Accordion.Control>
                      <Accordion.Panel>
                        <DocumentsTable documents={sp.documents} />
                      </Accordion.Panel>
                    </Accordion.Item>
                  ))}
                  {cat.subprocesses.length === 0 && (
                    <Text size="sm" c="dimmed" py="md" ta="center">
                      Esta categoría todavía no tiene sub-procesos sembrados.
                    </Text>
                  )}
                </Accordion>
              </Tabs.Panel>
            ))}

            <Tabs.Panel value="sin-clasificar" pt="md">
              <Text size="sm" c="dimmed" mb="md">
                Documentos Vigentes que todavía no están ligados a una categoría de proceso.
                {canWriteAny
                  ? ' Seleccione un sub-proceso y confirme para clasificarlos.'
                  : ' Necesita permiso de escritura en el módulo para clasificarlos.'}
              </Text>

              {filteredUnclassified.length === 0 ? (
                <Stack align="center" gap={4} py="xl">
                  <IconCircleCheck size={40} className="text-gray-300" />
                  <Text size="sm" c="dimmed">
                    No hay documentos vigentes sin clasificar.
                  </Text>
                </Stack>
              ) : (
                <Table.ScrollContainer minWidth={1000}>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Código</Table.Th>
                        <Table.Th>Documento</Table.Th>
                        <Table.Th>Empresa</Table.Th>
                        <Table.Th>Actualizado</Table.Th>
                        <Table.Th>Clasificar en</Table.Th>
                        <Table.Th></Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filteredUnclassified.map((d) => (
                        <Table.Tr key={d.id_document}>
                          <Table.Td>
                            <Anchor
                              component={Link}
                              href={`/process/document-management/${d.id_document}`}
                              size="sm"
                              fw={600}
                            >
                              {d.code}
                            </Anchor>
                          </Table.Td>
                          <Table.Td style={{ minWidth: 200, maxWidth: 300 }}>
                            <Text size="sm" lineClamp={2}>
                              {d.title}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge variant="light">{d.company.company}</Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              {formatDate(d.updated_at)}
                            </Text>
                          </Table.Td>
                          <Table.Td style={{ minWidth: 260 }}>
                            <Select
                              placeholder="Categoría / sub-proceso"
                              data={subprocessOptions}
                              searchable
                              disabled={!canWriteAny}
                              value={classifying[d.id_document] ?? null}
                              onChange={(v) =>
                                setClassifying((prev) => ({ ...prev, [d.id_document]: v }))
                              }
                            />
                          </Table.Td>
                          <Table.Td>
                            <Button
                              size="xs"
                              loading={savingId === d.id_document}
                              disabled={!canWriteAny || !classifying[d.id_document]}
                              onClick={() => classifyDocument(d.id_document)}
                            >
                              Clasificar
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Tabs.Panel>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
