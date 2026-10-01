'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Collapse,
  Flex,
  Grid,
  Group,
  Loader,
  LoadingOverlay,
  Modal,
  ScrollArea,
  Select,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuilding,
  IconCheck,
  IconChevronRight,
  IconFileDescription,
  IconFlag,
  IconFilter,
  IconPlus,
  IconRefresh,
  IconTag,
  IconTicket,
  IconUserCheck,
  IconX,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import type { SgcFlowProcessSummary } from '../../../lib/sgc/db/flows';
import { SGC_FLOW_CATEGORIES } from '../../../lib/sgc/flows/definition';
import { sgcHref, useSgcCompany } from '../useSgcCompany';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { useSgcRowLink } from '../useSgcRowLink';
import { LG_FIELD, MD_FIELD, categoryLabel, statusColor } from './SgcFlowUi';

/**
 * «Flujos de Trabajo» de Documentos. COPIA CONGELADA (2026-10-01) de la
 * lista de Flujos de Trabajo de SynerLink
 * (app/(hub)/process/request-general/workflows/page.tsx): misma cabecera,
 * indicadores, filtros, tabla y modal de creación, sobre /api/sgc/flows.
 * La fila entera abre la vista interna del flujo (/flujos/<id>).
 */

const EMPTY_FILTERS = { category: '', process: '', active: '' };
const EMPTY_FLOW = { code: '', name: '', category: 'documental', description: '', reason: '' };

export const SGC_FLOWS_URL = `${SGC_BASE_URL}/flujos`;

export default function SgcFlowsList() {
  const router = useRouter();
  const rowLink = useSgcRowLink();
  const { estado, company, companyId, setCompanyId } = useSgcCompany();
  const idCompany = company?.idCompany ?? null;
  const allowed = !!company && (company.canAdminFlows || company.canQuality);
  const flows = useSgcFetch<{ flows: SgcFlowProcessSummary[] }>(allowed && idCompany ? `/api/sgc/flows?company=${idCompany}` : null);
  const all = useMemo(() => flows.data?.flows ?? [], [flows.data]);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [modalOpened, setModalOpened] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState(EMPTY_FLOW);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const list = useMemo(
    () =>
      all.filter(
        (f) =>
          (!applied.category || f.category === applied.category) &&
          (!applied.process || String(f.id) === applied.process) &&
          (!applied.active || (applied.active === '1') === f.isActive)
      ),
    [all, applied]
  );

  const closeModal = () => {
    setModalOpened(false);
    setCurrentStep(1);
    setFormErrors({});
    setCreateError(null);
    setFormData(EMPTY_FLOW);
  };

  const handleCreate = async () => {
    if (formData.reason.trim().length < 5) {
      setFormErrors({ reason: 'Indique el motivo del cambio (mínimo 5 caracteres)' });
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await sgcSend<{ idFlowProcess?: number; idFlowVersion: number }>('/api/sgc/flows', 'POST', { company: idCompany, ...formData });
      toast.success('Flujo creado con su versión 1 en borrador.');
      flows.reload();
      const created = res.idFlowProcess;
      closeModal();
      if (created) router.push(sgcHref(`${SGC_FLOWS_URL}/${created}`, idCompany, { creado: '1' }));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  };

  if (estado.tipo === 'cargando' || (flows.loading && !flows.data)) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Group gap='sm'>
          <Loader size='sm' />
          <div>Cargando...</div>
        </Group>
      </div>
    );
  }

  const breadcrumbItems = [
    { title: 'Documentos', href: sgcHref(SGC_BASE_URL, idCompany) },
    { title: 'Flujos de Trabajo', href: '#' },
    { title: 'Proceso', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-600 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <span key={index} className='text-[var(--mantine-color-dimmed)]'>
        {item.title}
      </span>
    )
  );

  const companies = estado.tipo === 'listo' ? estado.companies.map((c) => ({ value: String(c.idCompany), label: c.companyName })) : [];
  const categories = SGC_FLOW_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }));
  const processes = all.map((f) => ({ value: String(f.id), label: `${f.code} · ${f.name}` }));
  const canCreate = !!company?.canAdminFlows;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6' data-testid='sgc-flujos-cabecera'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3' data-testid='sgc-titulo'>
                <IconTicket size={32} className='text-blue-600' />
                Flujos de Trabajo
              </Title>
              <Text size='lg' c='dimmed'>
                Gestión de Flujos de Trabajo de Documentos
              </Text>
            </div>

            {canCreate && (
              <Button onClick={() => setModalOpened(true)} size='lg' leftSection={<IconPlus size={18} />} className='bg-blue-600 hover:bg-blue-700' data-testid='sgc-flujo-nuevo'>
                Crear Flujo De Trabajo
              </Button>
            )}
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder style={{ backgroundColor: 'var(--mantine-color-blue-light)' }}>
                <Group>
                  <IconTicket size={24} className='text-blue-600' />
                  <div>
                    <Text size='xs' c='blue.6'>
                      Total de Flujos de Trabajo
                    </Text>
                    <Text size='lg' fw={600}>
                      {all.length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Card p='md' radius='md' withBorder style={{ backgroundColor: 'var(--mantine-color-green-light)' }}>
                <Group>
                  <IconCheck size={24} className='text-green-600' />
                  <div>
                    <Text size='xs' c='green.6'>
                      Vigentes
                    </Text>
                    <Text size='lg' fw={600}>
                      {all.filter((f) => f.currentVersion != null).length}
                    </Text>
                  </div>
                </Group>
              </Card>
            </Grid.Col>
          </Grid>
        </Card>

        {!allowed && company && (
          <Alert icon={<IconAlertCircle size={20} />} title='Sin acceso' color='yellow' mb='md' data-testid='sgc-solo-flujos'>
            Esta sección es exclusiva de la administración de flujos validados y de Aseguramiento de Calidad.
          </Alert>
        )}
        {estado.tipo === 'error' && (
          <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md'>
            {estado.mensaje}
          </Alert>
        )}
        {estado.tipo === 'listo' && !company && (
          <Alert icon={<IconAlertCircle size={20} />} title='Documentos' color='yellow' mb='md' data-testid='sgc-sin-acceso'>
            No tiene acceso a Documentos en ninguna empresa activa.
          </Alert>
        )}
        {flows.error && (
          <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md' className='border-red-200 bg-red-50'>
            {flows.error}
          </Alert>
        )}

        <Card shadow='sm' p='lg' radius='md' withBorder mb='6'>
          <Group justify='space-between' mb='md'>
            <Title order={3} className='flex items-center gap-2'>
              <IconFilter size={20} />
              Filtros de Búsqueda
            </Title>
            <ActionIcon variant='subtle' onClick={() => setFiltersExpanded(!filtersExpanded)} aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}>
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Empresa'
                    placeholder='Todas las empresas'
                    data={companies}
                    value={companyId}
                    onChange={(value) => value && setCompanyId(value)}
                    allowDeselect={false}
                    leftSection={<IconBuilding size={16} />}
                    size='md'
                    classNames={MD_FIELD}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Categoria'
                    placeholder='Todas las categorias'
                    clearable
                    data={categories}
                    value={filters.category || null}
                    onChange={(value) => setFilters({ ...filters, category: value || '' })}
                    leftSection={<IconBuilding size={16} />}
                    size='md'
                    classNames={MD_FIELD}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Proceso'
                    placeholder='Todas los procesos'
                    clearable
                    data={processes}
                    value={filters.process || null}
                    onChange={(value) => setFilters({ ...filters, process: value || '' })}
                    leftSection={<IconBuilding size={16} />}
                    size='md'
                    classNames={MD_FIELD}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Vigencia'
                    placeholder='Activo / Inactivo'
                    clearable
                    data={[
                      { value: '1', label: 'Activo' },
                      { value: '0', label: 'Inactivo' },
                    ]}
                    value={filters.active || null}
                    onChange={(value) => setFilters({ ...filters, active: value || '' })}
                    leftSection={<IconFlag size={16} />}
                    size='md'
                    classNames={MD_FIELD}
                  />
                </Grid.Col>
              </Grid>

              <Group justify='flex-end' mt='md'>
                <Button
                  variant='outline'
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setApplied(EMPTY_FILTERS);
                  }}
                  leftSection={<IconX size={16} />}
                >
                  Limpiar Filtros
                </Button>
                <Button
                  onClick={() => {
                    setApplied(filters);
                    flows.reload();
                  }}
                  leftSection={<IconRefresh size={16} />}
                >
                  Aplicar Filtros
                </Button>
              </Group>
            </Box>
          </Collapse>
        </Card>

        <Card shadow='sm' radius='md' withBorder className='overflow-hidden'>
          <LoadingOverlay visible={flows.loading} />

          <Title order={3} mb='md' className='flex items-center gap-2'>
            <IconTicket size={20} />
            Lista de Flujos de Trabajo
          </Title>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover data-testid='sgc-flujos-tabla'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Código</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Categoria</Table.Th>
                  <Table.Th>Proceso</Table.Th>
                  <Table.Th>Asignado Proceso</Table.Th>
                  <Table.Th>Versión</Table.Th>
                  <Table.Th>Activo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={8} className='text-center py-12 text-[var(--mantine-color-dimmed)]'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconTicket size={48} style={{ color: 'var(--mantine-color-dimmed)' }} />
                        <Text size='lg' fw={500}>
                          No se encontraron flujos de trabajo
                        </Text>
                        <Text size='sm' c='dimmed'>
                          No hay flujos de trabajo de Documentos con estos filtros
                        </Text>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  list.map((f) => {
                    const vigente = f.versions.find((v) => v.status === 'vigente');
                    const borrador = f.versions.find((v) => v.status === 'borrador');
                    return (
                      <Table.Tr key={f.id} data-testid='sgc-flujo-fila' data-code={f.code} {...rowLink(sgcHref(`${SGC_FLOWS_URL}/${f.id}`, idCompany))}>
                        <Table.Td>
                          <Text size='xs' color='blue' className='max-w-xs truncate' lineClamp={2}>
                            {f.code}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} className='flex'>
                            <IconBuilding size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />
                            <Text size='sm' className='max-w-xs truncate'>
                              {company?.companyName}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' className='max-w-xs truncate'>
                            {categoryLabel(f.category)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' c='dimmed'>
                            {f.name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            <IconUserCheck size={14} style={{ color: 'var(--mantine-color-dimmed)' }} />
                            <Text size='sm'>{f.ownerEmail || 'Sin asignar'}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            {vigente && (
                              <Badge color={statusColor('vigente')} variant='light' size='sm' data-testid='sgc-flujo-version' data-status='vigente'>
                                v{vigente.versionNumber} vigente
                              </Badge>
                            )}
                            {borrador && (
                              <Badge color={statusColor('borrador')} variant='light' size='sm' data-testid='sgc-flujo-version' data-status='borrador'>
                                v{borrador.versionNumber} borrador
                              </Badge>
                            )}
                            {!vigente && !borrador && (
                              <Text size='sm' c='dimmed'>
                                Sin versión vigente
                              </Text>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={f.isActive ? 'green' : 'red'} variant='light' size='sm'>
                            {f.isActive ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Card>

        <Modal
          opened={modalOpened}
          onClose={closeModal}
          title={
            <Group gap='sm'>
              <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100'>
                <IconPlus size={20} className='text-blue-600' />
              </div>
              <div>
                <Text size='lg' fw={600}>
                  Crear Flujo de Trabajo
                </Text>
                <Text size='xs' c='dimmed'>
                  Complete los campos obligatorios marcados con *
                </Text>
              </div>
            </Group>
          }
          size='70%'
          radius='lg'
          overlayProps={{ blur: 4 }}
          centered
          classNames={{ header: 'border-b border-gray-100 pb-4', body: 'pt-4' }}
        >
          <LoadingOverlay visible={createLoading} />

          {createError && (
            <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red' mb='md' className='border-red-200 bg-red-50' data-testid='sgc-flujos-mensaje'>
              {createError}
            </Alert>
          )}

          {/* Stepper */}
          <div className='flex items-center justify-between mb-6 px-4 pt-4'>
            {[1, 2].map((step) => (
              <div key={step} className='flex items-center flex-1'>
                <div className='flex items-center gap-3'>
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full border-2 font-semibold transition-all duration-200 ${
                      currentStep === step
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : currentStep > step
                          ? 'bg-green-500 border-green-500 text-white'
                          : 'bg-[var(--mantine-color-body)] border-[var(--mantine-color-default-border)] text-[var(--mantine-color-dimmed)]'
                    }`}
                  >
                    {currentStep > step ? <IconCheck size={18} /> : step}
                  </div>
                  <div className='flex flex-col'>
                    <Text size='sm' fw={600} className={currentStep === step ? 'text-blue-600' : currentStep > step ? 'text-green-600' : 'text-[var(--mantine-color-dimmed)]'}>
                      {step === 1 ? 'Información General' : 'Categoría y Proceso'}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {step === 1 ? 'Paso 1 de 2' : 'Paso 2 de 2'}
                    </Text>
                  </div>
                </div>
                {step < 2 && <div className={`flex-1 h-0.5 mx-4 transition-colors duration-200 ${currentStep > step ? 'bg-green-500' : 'bg-[var(--mantine-color-default-border)]'}`} />}
              </div>
            ))}
          </div>

          <ScrollArea.Autosize mah='calc(100vh - 400px)'>
            {currentStep === 1 && (
              <div className='space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300'>
                <div className='rounded-lg border p-6' style={{ backgroundColor: 'var(--mantine-color-body)', borderColor: 'var(--mantine-color-default-border)' }}>
                  <div className='mb-4'>
                    <Group gap='sm' mb={3}>
                      <div className='flex items-center justify-center w-8 h-8 rounded-md bg-blue-50'>
                        <IconFileDescription size={16} className='text-blue-600' />
                      </div>
                      <Text fw={600} size='md'>
                        Paso 1: Información General
                      </Text>
                    </Group>
                    <Text size='sm' c='dimmed'>
                      Identifique el flujo de trabajo. Se crea con la versión 1 en borrador (solicitud → ejecución) para ajustarla y publicarla.
                    </Text>
                  </div>

                  <Grid>
                    <Grid.Col span={{ base: 12, md: 8 }}>
                      <Select label='Empresa Solicitante' data={companies} value={companyId} disabled leftSection={<IconBuilding size={16} />} size='lg' classNames={LG_FIELD} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <TextInput
                        label='Código'
                        placeholder='Ej. CC'
                        description='Mayúsculas, p. ej. CC (control de cambios)'
                        required
                        value={formData.code}
                        onChange={(e) => setFormData({ ...formData, code: e.currentTarget.value.toUpperCase() })}
                        error={formErrors.code}
                        leftSection={<IconTag size={16} />}
                        size='lg'
                        classNames={LG_FIELD}
                        data-testid='sgc-nuevo-flujo-codigo'
                      />
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <TextInput
                        label='Nombre del Proceso'
                        placeholder='Ingrese el nombre del proceso'
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.currentTarget.value })}
                        error={formErrors.name}
                        size='lg'
                        classNames={LG_FIELD}
                        data-testid='sgc-nuevo-flujo-nombre'
                      />
                    </Grid.Col>
                  </Grid>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className='space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300'>
                <div className='rounded-lg border p-6 space-y-6' style={{ backgroundColor: 'var(--mantine-color-body)', borderColor: 'var(--mantine-color-default-border)' }}>
                  <div className='mb-2'>
                    <Group gap='sm' mb={3}>
                      <div className='flex items-center justify-center w-8 h-8 rounded-md bg-blue-50'>
                        <IconTag size={16} className='text-blue-600' />
                      </div>
                      <Text fw={600} size='md'>
                        Paso 2: Categoría y Proceso
                      </Text>
                    </Group>
                    <Text size='sm' c='dimmed'>
                      Configure la categoría y la descripción. Todo cambio queda en el registro de cambios con su motivo.
                    </Text>
                  </div>

                  <Grid>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Select
                        label='Categoría'
                        placeholder='Seleccione la categoría'
                        data={categories}
                        value={formData.category}
                        onChange={(v) => setFormData({ ...formData, category: v ?? 'otro' })}
                        allowDeselect={false}
                        required
                        leftSection={<IconTag size={16} />}
                        size='lg'
                        classNames={LG_FIELD}
                      />
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <Textarea label='Descripción' placeholder='Ingrese la descripción' autosize minRows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.currentTarget.value })} classNames={{ label: 'text-sm font-medium mb-2' }} />
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <Textarea
                        label='Motivo (control de cambios)'
                        placeholder='Por qué se crea este flujo'
                        required
                        autosize
                        minRows={2}
                        value={formData.reason}
                        onChange={(e) => setFormData({ ...formData, reason: e.currentTarget.value })}
                        error={formErrors.reason}
                        classNames={{ label: 'text-sm font-medium mb-2' }}
                        data-testid='sgc-nuevo-flujo-motivo'
                      />
                    </Grid.Col>
                  </Grid>
                </div>
              </div>
            )}
          </ScrollArea.Autosize>

          {/* Botones de acción */}
          <div className='flex items-center justify-between pt-4 mt-4 border-t border-gray-100'>
            <Button variant='outline' onClick={() => (currentStep > 1 ? setCurrentStep(currentStep - 1) : closeModal())} size='md' className='cursor-pointer transition-colors duration-200'>
              {currentStep === 1 ? 'Cancelar' : 'Anterior'}
            </Button>

            <div className='flex items-center gap-3'>
              {currentStep < 2 && (
                <Button
                  onClick={() => {
                    if (!formData.code.trim() || !formData.name.trim()) {
                      setFormErrors({ code: !formData.code.trim() ? 'Este campo es obligatorio' : '', name: !formData.name.trim() ? 'Este campo es obligatorio' : '' });
                      return;
                    }
                    setFormErrors({});
                    setCurrentStep(2);
                  }}
                  size='md'
                  rightSection={<IconChevronRight size={16} />}
                  className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'
                  data-testid='sgc-nuevo-flujo-siguiente'
                >
                  Siguiente
                </Button>
              )}
              {currentStep === 2 && (
                <Button onClick={handleCreate} loading={createLoading} size='md' leftSection={<IconPlus size={16} />} className='bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200' data-testid='sgc-nuevo-flujo-crear'>
                  Crear Flujo de Trabajo
                </Button>
              )}
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
