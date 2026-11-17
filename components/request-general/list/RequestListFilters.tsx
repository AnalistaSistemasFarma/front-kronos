'use client';

import { useState, type ReactNode } from 'react';
import { Badge, Box, Button, Collapse, Grid, Group, Select, Text, TextInput } from '@mantine/core';
import {
  IconArrowBackUp,
  IconBuilding,
  IconCalendarEvent,
  IconCheck,
  IconFileDescription,
  IconFilter,
  IconFlag,
  IconHash,
  IconListDetails,
  IconProgress,
  IconSitemap,
  IconUserCheck,
  IconX,
} from '@tabler/icons-react';
import { FilterPanel, ProgressRingTile, StatFilterTile } from './RequestListUi';
import styles from './requestList.module.css';
import {
  activeFilterCount,
  stateGroup,
  type ListFilters,
  type ListOptions,
  type StatusCounts,
  type StatusGroup,
} from '../../../lib/requests-general/listFilters';

/**
 * Tarjetas + panel de filtros de los listados de solicitudes. Lo usan Mis solicitudes y
 * Asignadas para que se vean y funcionen igual. Los filtros se aplican al instante (sin botón
 * "Aplicar") sobre toda la lista; las tarjetas filtran por estado general y al tocar la
 * tarjeta ya marcada se vuelve a "Todos".
 */
export function RequestListFilters({
  filters,
  onChange,
  onClear,
  counts,
  hints,
  options,
  progress,
  progressLabel = 'Avance de tareas',
  progressHint,
  onProgressClick,
  extraFields,
  extraActiveCount = 0,
  showReturned = false,
}: {
  filters: ListFilters;
  onChange: (next: ListFilters) => void;
  /** Limpia filtros, estado y buscador. */
  onClear: () => void;
  counts: StatusCounts;
  /** Línea pequeña bajo cada número (p. ej. "3 solicitudes · 2 tareas"). */
  hints?: Partial<Record<StatusGroup, ReactNode>>;
  options: ListOptions;
  progress: { done: number; total: number; percent: number };
  progressLabel?: string;
  progressHint?: ReactNode;
  onProgressClick?: () => void;
  extraFields?: ReactNode;
  extraActiveCount?: number;
  showReturned?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const set = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const groupOfState = (state: string): StatusGroup => {
    const group = stateGroup(state);
    return group === 'returned' && !showReturned ? 'pending' : group;
  };
  const pickStatus = (status: StatusGroup) => {
    const next = filters.status === status && status !== 'all' ? 'all' : status;
    const keepState = filters.state && next !== 'all' && groupOfState(filters.state) === next;
    onChange({ ...filters, status: next, state: keepState ? filters.state : '' });
  };
  const pickState = (state: string) =>
    onChange({ ...filters, state, status: state ? groupOfState(state) : filters.status });
  const active = activeFilterCount(filters) + extraActiveCount;

  const tiles: Array<{
    key: StatusGroup;
    label: string;
    icon: ReactNode;
    tone: 'info' | 'warning' | 'ok' | 'critical' | 'violet';
  }> = [
    { key: 'all', label: 'Total', icon: <IconListDetails size={20} />, tone: 'info' },
    { key: 'pending', label: 'Pendientes', icon: <IconProgress size={20} />, tone: 'warning' },
    ...(showReturned
      ? [{ key: 'returned' as const, label: 'Devueltas', icon: <IconArrowBackUp size={20} />, tone: 'violet' as const }]
      : []),
    { key: 'done', label: 'Completadas', icon: <IconCheck size={20} />, tone: 'ok' },
    { key: 'cancelled', label: 'Canceladas', icon: <IconX size={20} />, tone: 'critical' },
  ];

  return (
    <>
      <div className={styles.statGrid}>
        {tiles.map((tile) => (
          <StatFilterTile
            key={tile.key}
            icon={tile.icon}
            label={tile.label}
            value={counts[tile.key]}
            hint={hints?.[tile.key]}
            tone={tile.tone}
            active={filters.status === tile.key}
            onClick={() => pickStatus(tile.key)}
            ariaLabel={tile.key === 'all' ? 'Mostrar todo' : `Mostrar ${tile.label.toLowerCase()}`}
          />
        ))}
        <ProgressRingTile
          label={progressLabel}
          done={progress.done}
          total={progress.total}
          percent={progress.percent}
          hint={progressHint}
          onClick={onProgressClick}
        />
      </div>

      <FilterPanel
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        icon={<IconFilter size={18} />}
      >
        {active > 0 && !expanded ? (
          <Text size='sm' c='dimmed' mt={6}>
            {active} filtro{active === 1 ? '' : 's'} activo{active === 1 ? '' : 's'}
          </Text>
        ) : null}
        <Collapse in={expanded}>
          <Box mt='md'>
            <Grid>
              <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <TextInput
                  label='ID Solicitud'
                  placeholder='Ej. 1520'
                  inputMode='numeric'
                  value={filters.id}
                  onChange={(e) => set('id', e.currentTarget.value.replace(/[^\d#]/g, ''))}
                  leftSection={<IconHash size={16} />}
                  data-testid='id-filter'
                />
              </Grid.Col>
              {options.states ? (
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Estado'
                    placeholder='Todos los estados'
                    clearable
                    data={options.states}
                    value={filters.state || null}
                    onChange={(value) => pickState(value || '')}
                    leftSection={<IconFlag size={16} />}
                    data-testid='status-filter'
                  />
                </Grid.Col>
              ) : null}
              <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <Select
                  label='Empresa'
                  placeholder='Todas las empresas'
                  clearable
                  searchable
                  data={options.companies}
                  value={filters.company || null}
                  onChange={(value) => set('company', value || '')}
                  leftSection={<IconBuilding size={16} />}
                  nothingFoundMessage='Sin coincidencias'
                  data-testid='company-filter'
                />
              </Grid.Col>
              {options.categories ? (
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Categoría'
                    placeholder='Todas las categorías'
                    clearable
                    searchable
                    data={options.categories}
                    value={filters.category || null}
                    onChange={(value) => set('category', value || '')}
                    leftSection={<IconFileDescription size={16} />}
                    nothingFoundMessage='Sin coincidencias'
                    data-testid='category-filter'
                  />
                </Grid.Col>
              ) : null}
              <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <Select
                  label='Proceso'
                  placeholder='Todos los procesos'
                  clearable
                  searchable
                  data={options.processes}
                  value={filters.process || null}
                  onChange={(value) => set('process', value || '')}
                  leftSection={<IconSitemap size={16} />}
                  nothingFoundMessage='Sin coincidencias'
                  data-testid='process-filter'
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <Select
                  label='Persona asignada'
                  placeholder='Todas las personas'
                  clearable
                  searchable
                  data={options.people}
                  value={filters.person || null}
                  onChange={(value) => set('person', value || '')}
                  leftSection={<IconUserCheck size={16} />}
                  nothingFoundMessage='Sin coincidencias'
                  data-testid='assigned_to-filter'
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <TextInput
                  label='Fecha desde'
                  type='date'
                  value={filters.date_from}
                  onChange={(e) => set('date_from', e.currentTarget.value)}
                  leftSection={<IconCalendarEvent size={16} />}
                  data-testid='date_from-filter'
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                <TextInput
                  label='Fecha hasta'
                  type='date'
                  value={filters.date_to}
                  onChange={(e) => set('date_to', e.currentTarget.value)}
                  leftSection={<IconCalendarEvent size={16} />}
                  data-testid='date_to-filter'
                />
              </Grid.Col>
              {extraFields}
            </Grid>

            <Group justify='space-between' mt='md' wrap='wrap' gap='sm'>
              <Group gap={6}>
                <Text size='sm' c='dimmed'>
                  Se aplican al instante sobre toda la lista.
                </Text>
                {active > 0 ? (
                  <Badge variant='light' radius='xl'>
                    {active} activo{active === 1 ? '' : 's'}
                  </Badge>
                ) : null}
              </Group>
              <Button
                variant='outline'
                onClick={onClear}
                leftSection={<IconX size={16} />}
                data-testid='clear-filters'
              >
                Limpiar filtros
              </Button>
            </Group>
          </Box>
        </Collapse>
      </FilterPanel>
    </>
  );
}
