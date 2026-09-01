'use client';

import { memo, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Group, ActionIcon, SimpleGrid } from '@mantine/core';
import {
  IconLayoutGrid,
  IconList,
  IconX,
  IconFolderOff,
} from '@tabler/icons-react';
import ProcessCard from './ProcessCard';
import ProcessSearch from './ProcessSearch';
import ProcessFilters from './ProcessFilters';
import ProcessSkeleton from './ProcessSkeleton';
import { useProcessData, type ProcessRecord } from '../../lib/process/ProcessDataContext';
import { isHubHiddenRequestDashboardSubprocess } from '../../lib/request-general/dashboardRoutes';

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

type Subprocess = ProcessRecord['subprocesses'][number];

function ProcessViewInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const { processes, loading, error } = useProcessData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const enhancedProcesses = useMemo(() => {
    return processes
      .map((process) => {
        const subprocesses = process.subprocesses.filter(
          (sub) => !isHubHiddenRequestDashboardSubprocess(sub)
        );
        return {
          ...process,
          subprocesses,
          company:
            subprocesses[0]?.subprocessUserCompanies?.[0]?.companyUser?.company?.company ||
            '',
        };
      })
      .filter((process) => process.subprocesses.length > 0);
  }, [processes]);

  const filteredProcesses = useMemo(() => {
    let filtered = enhancedProcesses;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (process) =>
          process.process.toLowerCase().includes(q) ||
          process.subprocesses.some((sub) =>
            sub.subprocess.toLowerCase().includes(q)
          )
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter((process) => {
        const name = process.process.toLowerCase();
        if (selectedCategory === 'administrative') {
          return name.includes('admin') || name.includes('management') || name.includes('administr');
        }
        if (selectedCategory === 'technical') {
          return name.includes('help') || name.includes('support') || name.includes('soporte') || name.includes('mesa');
        }
        if (selectedCategory === 'financial') {
          return name.includes('purchase') || name.includes('buy') || name.includes('compra') || name.includes('venta');
        }
        return true;
      });
    }

    return filtered;
  }, [enhancedProcesses, searchTerm, selectedCategory]);

  const categories = useMemo((): FilterOption[] => {
    const categoryCounts = {
      administrative: enhancedProcesses.filter((p) => {
        const n = p.process.toLowerCase();
        return n.includes('admin') || n.includes('management') || n.includes('administr');
      }).length,
      technical: enhancedProcesses.filter((p) => {
        const n = p.process.toLowerCase();
        return n.includes('help') || n.includes('support') || n.includes('soporte') || n.includes('mesa');
      }).length,
      financial: enhancedProcesses.filter((p) => {
        const n = p.process.toLowerCase();
        return n.includes('purchase') || n.includes('buy') || n.includes('compra') || n.includes('venta');
      }).length,
    };

    return [
      { value: 'administrative', label: 'Administrativos', count: categoryCounts.administrative },
      { value: 'technical', label: 'Soporte', count: categoryCounts.technical },
      { value: 'financial', label: 'Compras', count: categoryCounts.financial },
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

  const firstName = session.user?.name?.split(' ')[0] || '';

  if (loading && processes.length === 0) {
    return (
      <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
        <div className='max-w-6xl mx-auto py-10 px-4 sm:px-6 lg:px-8'>
          <h1 className='ios-process-hub__title text-3xl mb-2'>Procesos</h1>
          <p className='ios-process-hub__subtitle mb-8'>Cargando tus accesos…</p>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='lg'>
            <ProcessSkeleton count={6} />
          </SimpleGrid>
        </div>
      </div>
    );
  }

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div className='max-w-6xl mx-auto py-10 px-4 sm:px-6 lg:px-8'>
        <header className='mb-7'>
          <h1 className='ios-process-hub__title text-3xl sm:text-4xl mb-2'>
            {firstName ? `Hola, ${firstName}` : 'Procesos'}
          </h1>
          <p className='ios-process-hub__subtitle mb-6'>
            Elige un módulo para empezar. Cada tarjeta agrupa los accesos de ese proceso.
          </p>

          <ProcessSearch
            value={searchTerm}
            onChange={setSearchTerm}
            loading={loading}
          />
        </header>

        <ProcessFilters
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          totalCount={enhancedProcesses.length}
          className='mb-5'
        />

        <Group justify='space-between' mb='md'>
          <p className='text-sm' style={{ color: 'var(--app-text-muted)' }}>
            {filteredProcesses.length}{' '}
            {filteredProcesses.length === 1 ? 'proceso' : 'procesos'}
          </p>

          <Group gap={4}>
            <ActionIcon
              variant={viewMode === 'grid' ? 'filled' : 'subtle'}
              color='gray'
              size={40}
              radius='md'
              onClick={() => setViewMode('grid')}
              aria-label='Vista en tarjetas'
            >
              <IconLayoutGrid size={18} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === 'list' ? 'filled' : 'subtle'}
              color='gray'
              size={40}
              radius='md'
              onClick={() => setViewMode('list')}
              aria-label='Vista en lista'
            >
              <IconList size={18} />
            </ActionIcon>
          </Group>
        </Group>

        {error && (
          <Alert icon={<IconX size={16} />} title='Error' color='red' mb='md' radius='lg'>
            {error}
          </Alert>
        )}

        {filteredProcesses.length === 0 && !error ? (
          <div className='ios-empty'>
            <div className='ios-empty__icon'>
              <IconFolderOff size={26} />
            </div>
            <h2 className='text-lg font-semibold mb-1'>
              {searchTerm || selectedCategory
                ? 'Nada coincide con tu búsqueda'
                : 'Aún no tienes procesos'}
            </h2>
            <p className='ios-process-hub__subtitle mb-4'>
              {searchTerm || selectedCategory
                ? 'Prueba con otro nombre o limpia el filtro.'
                : 'Cuando te asignen un proceso, aparecerá aquí.'}
            </p>
            {(searchTerm || selectedCategory) && (
              <button
                type='button'
                className='ios-segment ios-segment--active'
                onClick={() => {
                  setSearchTerm('');
                  setSelectedCategory(null);
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        ) : viewMode === 'list' ? (
          <div className='flex flex-col gap-3'>
            {filteredProcesses.map((process, index) => (
              <ProcessCard
                key={process.id_process}
                process={process}
                colorIndex={index}
                onProcessClick={handleProcessClick}
                onSubprocessClick={handleSubprocessClick}
              />
            ))}
          </div>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='lg'>
            {filteredProcesses.map((process, index) => (
              <ProcessCard
                key={process.id_process}
                process={process}
                colorIndex={index}
                onProcessClick={handleProcessClick}
                onSubprocessClick={handleSubprocessClick}
              />
            ))}
          </SimpleGrid>
        )}
      </div>
    </div>
  );
}

const ProcessView = memo(ProcessViewInner);
export default ProcessView;
