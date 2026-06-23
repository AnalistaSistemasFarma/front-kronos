'use client';

import { memo, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Title, Text, Alert, Group, ActionIcon, SimpleGrid } from '@mantine/core';
import { IconLayoutGrid, IconList, IconX } from '@tabler/icons-react';
import { useTheme } from '../providers';
import GlassCard from '../ui/GlassCard';
import ProcessCard from './ProcessCard';
import ProcessSearch from './ProcessSearch';
import ProcessFilters from './ProcessFilters';
import ProcessSkeleton from './ProcessSkeleton';
import GradientButton from '../ui/GradientButton';
import { useProcessData, type ProcessRecord } from '../../lib/process/ProcessDataContext';
import { hasAdminRole } from '../../lib/access-control';
import { transformHelpDeskProcesses } from '../../lib/process/helpDeskNavigation';

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

type Subprocess = ProcessRecord['subprocesses'][number];

function ProcessViewInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const { theme } = useTheme();
  const { processes, loading, error } = useProcessData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const isAdmin = hasAdminRole(session?.user?.role);

  const enhancedProcesses = useMemo(() => {
    const withHelpDeskNav = transformHelpDeskProcesses(processes, isAdmin);
    return withHelpDeskNav.map((process) => ({
      ...process,
      lastAccessed: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      company:
        process.subprocesses[0]?.subprocessUserCompanies?.[0]?.companyUser?.company?.company ||
        'Oficina Principal',
      description: `Gestiona y rastrea las actividades, flujos de trabajo y tareas relacionadas de ${process.process.toLowerCase()} en todos los departamentos.`,
    }));
  }, [processes, isAdmin]);

  const filteredProcesses = useMemo(() => {
    let filtered = enhancedProcesses;

    if (searchTerm) {
      filtered = filtered.filter(
        (process) =>
          process.process.toLowerCase().includes(searchTerm.toLowerCase()) ||
          process.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          process.subprocesses.some((sub) =>
            sub.subprocess.toLowerCase().includes(searchTerm.toLowerCase())
          )
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter((process) => {
        if (selectedCategory === 'administrative') {
          return (
            process.process.toLowerCase().includes('admin') ||
            process.process.toLowerCase().includes('management')
          );
        }
        if (selectedCategory === 'technical') {
          return (
            process.process.toLowerCase().includes('help') ||
            process.process.toLowerCase().includes('support')
          );
        }
        if (selectedCategory === 'financial') {
          return (
            process.process.toLowerCase().includes('purchase') ||
            process.process.toLowerCase().includes('buy')
          );
        }
        return true;
      });
    }

    return filtered;
  }, [enhancedProcesses, searchTerm, selectedCategory]);

  const categories = useMemo((): FilterOption[] => {
    const categoryCounts = {
      administrative: enhancedProcesses.filter(
        (p) =>
          p.process.toLowerCase().includes('admin') ||
          p.process.toLowerCase().includes('management')
      ).length,
      technical: enhancedProcesses.filter(
        (p) =>
          p.process.toLowerCase().includes('help') || p.process.toLowerCase().includes('support')
      ).length,
      financial: enhancedProcesses.filter(
        (p) =>
          p.process.toLowerCase().includes('purchase') || p.process.toLowerCase().includes('buy')
      ).length,
    };

    return [
      { value: 'administrative', label: 'Administrativos', count: categoryCounts.administrative },
      { value: 'technical', label: 'Técnicos', count: categoryCounts.technical },
      { value: 'financial', label: 'Financieros', count: categoryCounts.financial },
    ].filter((category) => category.count > 0);
  }, [enhancedProcesses]);

  const handleProcessClick = (processId: number) => {
    const process = processes.find((p) => p.id_process === processId);
    if (process?.process_url) {
      window.open(process.process_url, '_blank');
    }
  };

  const handleSubprocessClick = (subprocess: Subprocess) => {
    if (subprocess.subprocess_url) {
      router.push(subprocess.subprocess_url);
    } else {
      router.push(`/process/help-desk/create-ticket?subprocess_id=${subprocess.id_subprocess}`);
    }
  };

  if (!session) {
    return null;
  }

  if (loading && processes.length === 0) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <div className='max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8'>
          <div className='mb-8'>
            <Title
              order={1}
              className={`text-3xl font-bold mb-2 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}
            >
              Procesos
            </Title>
            <Text className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
              Cargando procesos disponibles...
            </Text>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing='lg'>
            <ProcessSkeleton count={6} />
          </SimpleGrid>
        </div>
      </div>
    );
  }

  return (
    <div className='app-page-shell app-page-shell--fill min-h-screen'>
      <div className='max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8'>
        <div className='mb-8'>
          <Title
            order={1}
            className={`text-3xl font-bold mb-6 ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}
          >
            Procesos
          </Title>
          <Text className={`mb-8 ${theme === 'dark' ? 'text-white' : 'text-gray-600'}`}>
            Lista de procesos disponibles para tu usuario
          </Text>

          <ProcessSearch
            value={searchTerm}
            onChange={setSearchTerm}
            onFilterClick={() => setFiltersOpen(!filtersOpen)}
            loading={loading}
          />
        </div>

        <ProcessFilters
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          className='mb-6'
        />

        <Group justify='space-between' mb='md'>
          <Text size='sm' className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
            {filteredProcesses.length} {filteredProcesses.length === 1 ? 'proceso' : 'procesos'}{' '}
            encontrado{filteredProcesses.length !== 1 ? 's' : ''}
          </Text>

          <Group gap='xs'>
            <ActionIcon
              variant={viewMode === 'grid' ? 'filled' : 'light'}
              color='blue'
              onClick={() => setViewMode('grid')}
              style={{ backgroundColor: viewMode === 'grid' ? '#113562' : 'transparent' }}
            >
              <IconLayoutGrid size={16} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === 'list' ? 'filled' : 'light'}
              color='blue'
              onClick={() => setViewMode('list')}
              style={{ backgroundColor: viewMode === 'list' ? '#113562' : 'transparent' }}
            >
              <IconList size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {error && (
          <Alert icon={<IconX size={16} />} title='Error' color='red' mb='md'>
            {error}
          </Alert>
        )}

        {filteredProcesses.length === 0 && !error ? (
          <GlassCard className='text-center py-12'>
            <div className='empty-state'>
              <div className='empty-state-icon'>📁</div>
              <Title
                order={3}
                className={`mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
              >
                {searchTerm || selectedCategory
                  ? 'No se encontraron procesos'
                  : 'No hay procesos disponibles'}
              </Title>
              <Text className={`mb-4 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                {searchTerm || selectedCategory
                  ? 'Intenta ajustar tu búsqueda o filtros'
                  : 'No tienes procesos asignados en este momento.'}
              </Text>
              {(searchTerm || selectedCategory) && (
                <GradientButton
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategory(null);
                  }}
                  size='sm'
                >
                  Limpiar filtros
                </GradientButton>
              )}
            </div>
          </GlassCard>
        ) : (
          <div className={viewMode === 'list' ? 'process-list-container' : ''}>
            {viewMode === 'list' ? (
              <div className='process-list'>
                {filteredProcesses.map((process) => (
                  <div key={process.id_process} className='process-list-item'>
                    <ProcessCard
                      process={process}
                      onProcessClick={handleProcessClick}
                      onSubprocessClick={handleSubprocessClick}
                      className='list-view-card'
                    />
                  </div>
                ))}
              </div>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 3 }} spacing='lg'>
                {filteredProcesses.map((process) => (
                  <ProcessCard
                    key={process.id_process}
                    process={process}
                    onProcessClick={handleProcessClick}
                    onSubprocessClick={handleSubprocessClick}
                  />
                ))}
              </SimpleGrid>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
        }
        .process-list-container {
          width: 100%;
        }
        .process-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .process-list-item {
          width: 100%;
        }
        .list-view-card {
          margin-bottom: 0;
        }
        @media (max-width: 768px) {
          .process-list {
            gap: 12px;
          }
        }
      `}</style>
    </div>
  );
}

const ProcessView = memo(ProcessViewInner);
export default ProcessView;
