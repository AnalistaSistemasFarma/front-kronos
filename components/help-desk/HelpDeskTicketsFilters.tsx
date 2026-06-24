'use client';

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Grid,
  Group,
  Select,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconBuilding,
  IconCalendarEvent,
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconFlag,
  IconSearch,
  IconUser,
  IconUserOff,
  IconX,
} from '@tabler/icons-react';

export type TicketsBoardFilters = {
  priority: string;
  status: string;
  assigned_user: string;
  date_from: string;
  date_to: string;
  technician: string;
  company: string;
};

type Option = { value: string; label: string };

interface HelpDeskTicketsFiltersProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  isSearching: boolean;
  filters: TicketsBoardFilters;
  onFilterChange: (field: keyof TicketsBoardFilters, value: string) => void;
  technicals: Option[];
  loadingTechnicals: boolean;
  companies: Option[];
  loadingCompanies: boolean;
  filtersExpanded: boolean;
  onToggleExpanded: () => void;
  onClearAll: () => void;
  resultCount: number;
}

const UNASSIGNED_TECHNICIAN = 'unassigned';

export function getTechnicianFilterOptions(technicals: Option[]): Option[] {
  return [{ value: UNASSIGNED_TECHNICIAN, label: 'Sin asignar' }, ...technicals];
}

export function countActiveFilters(filters: TicketsBoardFilters, searchQuery: string): number {
  let count = 0;
  if (searchQuery.trim()) count += 1;
  if (filters.priority) count += 1;
  if (filters.status && filters.status !== '1') count += 1;
  if (filters.company) count += 1;
  if (filters.technician) count += 1;
  if (filters.date_from || filters.date_to) count += 1;
  return count;
}

export function HelpDeskTicketsFilters({
  searchQuery,
  onSearchQueryChange,
  isSearching,
  filters,
  onFilterChange,
  technicals,
  loadingTechnicals,
  companies,
  loadingCompanies,
  filtersExpanded,
  onToggleExpanded,
  onClearAll,
  resultCount,
}: HelpDeskTicketsFiltersProps) {
  const activeCount = countActiveFilters(filters, searchQuery);
  const technicianOptions = getTechnicianFilterOptions(technicals);

  return (
    <Card
      shadow='sm'
      p='lg'
      radius='md'
      withBorder
      mb='md'
      className='bg-white overflow-hidden'
      style={{ borderTop: '3px solid var(--mantine-color-blue-6)' }}
    >
      <Group justify='space-between' wrap='wrap' gap='sm'>
        <Group gap='sm'>
          <Title order={3} className='flex items-center gap-2 text-gray-900'>
            <IconFilter size={20} className='text-blue-600' />
            Filtros de búsqueda
          </Title>
          {activeCount > 0 && (
            <Badge variant='light' color='blue' size='lg' radius='sm'>
              {activeCount} activo{activeCount === 1 ? '' : 's'}
            </Badge>
          )}
        </Group>
        <Group gap='sm'>
          <Text size='sm' c='dimmed'>
            {isSearching ? 'Buscando…' : `${resultCount} caso${resultCount === 1 ? '' : 's'}`}
          </Text>
          <Button
            variant='light'
            color='blue'
            size='sm'
            onClick={onToggleExpanded}
            leftSection={filtersExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
            aria-expanded={filtersExpanded}
            aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
          >
            {filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
          </Button>
        </Group>
      </Group>

      <Collapse in={filtersExpanded}>
        <Box mt='md' pt='md' className='border-t border-gray-100'>
          <Grid gutter='md' align='flex-end'>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <TextInput
                label='Buscar casos'
                description='Filtra en vivo por ID, nombre del solicitante o asunto'
                placeholder='Ej: 2315, Karen Rodríguez, acceso Synerlink…'
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.currentTarget.value)}
                leftSection={<IconSearch size={18} className='text-blue-600' />}
                rightSection={
                  searchQuery ? (
                    <ActionIcon
                      variant='subtle'
                      color='gray'
                      size='sm'
                      onClick={() => onSearchQueryChange('')}
                      aria-label='Limpiar búsqueda'
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  ) : null
                }
                size='md'
                radius='md'
                classNames={{
                  input: 'border-gray-200 focus:border-blue-500',
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Select
                label='Técnico asignado'
                description='Incluye casos sin técnico'
                placeholder='Todos los técnicos'
                clearable
                searchable
                data={technicianOptions}
                value={filters.technician || null}
                onChange={(value) => onFilterChange('technician', value || '')}
                leftSection={
                  filters.technician === UNASSIGNED_TECHNICIAN ? (
                    <IconUserOff size={16} className='text-orange-600' />
                  ) : (
                    <IconUser size={16} className='text-blue-600' />
                  )
                }
                disabled={loadingTechnicals}
                size='md'
                radius='md'
                nothingFoundMessage='No hay técnicos'
              />
            </Grid.Col>
          </Grid>

          <Grid mt='md'>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Select
                label='Prioridad'
                placeholder='Todas'
                clearable
                data={[
                  { value: 'Baja', label: 'Baja' },
                  { value: 'Media', label: 'Media' },
                  { value: 'Alta', label: 'Alta' },
                ]}
                value={filters.priority || null}
                onChange={(value) => onFilterChange('priority', value || '')}
                leftSection={<IconFlag size={16} />}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Select
                label='Estado'
                placeholder='Todos'
                data={[
                  { value: '0', label: 'Todos' },
                  { value: '1', label: 'Abierto' },
                  { value: '2', label: 'Resuelto' },
                  { value: '3', label: 'Cancelado' },
                  { value: '4', label: 'En progreso' },
                ]}
                value={filters.status}
                onChange={(value) => onFilterChange('status', value || '1')}
                leftSection={<IconFlag size={16} />}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Select
                label='Empresa'
                placeholder='Todas'
                clearable
                searchable
                data={companies}
                value={filters.company || null}
                onChange={(value) => onFilterChange('company', value || '')}
                leftSection={<IconBuilding size={16} />}
                disabled={loadingCompanies}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <TextInput
                label='Fecha desde'
                type='date'
                value={filters.date_from}
                onChange={(e) => onFilterChange('date_from', e.currentTarget.value)}
                leftSection={<IconCalendarEvent size={16} />}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <TextInput
                label='Fecha hasta'
                type='date'
                value={filters.date_to}
                onChange={(e) => onFilterChange('date_to', e.currentTarget.value)}
                leftSection={<IconCalendarEvent size={16} />}
              />
            </Grid.Col>
          </Grid>

          <Group justify='flex-end' mt='md'>
            <Button
              variant='subtle'
              color='gray'
              onClick={onClearAll}
              leftSection={<IconX size={16} />}
              disabled={activeCount === 0}
            >
              Limpiar todo
            </Button>
          </Group>
        </Box>
      </Collapse>
    </Card>
  );
}
