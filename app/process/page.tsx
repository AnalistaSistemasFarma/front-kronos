'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Title, Text, Alert, Group, ActionIcon, SimpleGrid } from '@mantine/core';
import { IconLayoutGrid, IconList, IconX } from '@tabler/icons-react';
import GlassCard from '../../components/ui/GlassCard';
import ProcessCard from '../../components/process/ProcessCard';
import ProcessSearch from '../../components/process/ProcessSearch';
import ProcessFilters from '../../components/process/ProcessFilters';
import ProcessSkeleton from '../../components/process/ProcessSkeleton';
import AnimatedBackground from '../../components/layout/AnimatedBackground';
import GradientButton from '../../components/ui/GradientButton';

interface Company {
  id_company: number;
  company: string;
}

interface CompanyUser {
  id_company_user: number;
  company: Company;
}

interface SubprocessUserCompany {
  id_subprocess_user_company: number;
  companyUser: CompanyUser;
}

interface Subprocess {
  id_subprocess: number;
  subprocess: string;
  subprocess_url?: string;
  subprocessUserCompanies?: SubprocessUserCompany[]; // Hacemos opcional para compatibilidad
}

interface Process {
  id_process: number;
  process: string;
  process_url?: string;
  subprocesses: Subprocess[];
}

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export default function ProcessPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchProcesses();
  }, [session, status, router]);

  const fetchProcesses = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/processes');
      if (!response.ok) {
        throw new Error('Error al obtener los procesos');
      }
      const data: Process[] = await response.json();
      setProcesses(data);
    } catch (err) {
      setError('No se pueden cargar los procesos. Por favor, inténtalo de nuevo.');
      console.error('Error fetching processes:', err);
    } finally {
      setLoading(false);
    }
  };

  // Enhanced process data with additional properties
  const enhancedProcesses = useMemo(() => {
    return processes.map((process) => ({
      ...process,
      status: 'active' as const, // Default status, could be enhanced with real data
      lastAccessed: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(), // Random date within last week
      company:
        process.subprocesses[0]?.subprocessUserCompanies?.[0]?.companyUser?.company?.company ||
        'Oficina Principal',
      description: `Gestiona y rastrea las actividades, flujos de trabajo y tareas relacionadas de ${process.process.toLowerCase()} en todos los departamentos.`,
    }));
  }, [processes]);

  // Filter and search logic
  const filteredProcesses = useMemo(() => {
    let filtered = enhancedProcesses;

    // Search filter
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

    // Category filter (simplified - in real app, this would be more sophisticated)
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

  // Generate categories for filters
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
    ].filter((category) => category.count > 0); // Only show categories with processes
  }, [enhancedProcesses]);

  const handleProcessClick = (processId: number) => {
    const process = processes.find((p) => p.id_process === processId);
    if (process?.process_url) {
      window.open(process.process_url, '_blank');
    }
  };

  const handleSubprocessClick = (subprocess: Subprocess) => {
    if (subprocess.subprocess_url) {
      try {
        if (subprocess.subprocess_url.startsWith('/')) {
          router.push(subprocess.subprocess_url);
        } else {
          router.push(subprocess.subprocess_url);
        }
      } catch (error) {
        console.error('Invalid subprocess URL:', subprocess.subprocess_url, 'Error:', error);
        alert('La URL del subproceso no es válida. Por favor, contacta al administrador.');
      }
    } else {
      router.push(`/process/help-desk/create-ticket?subprocess_id=${subprocess.id_subprocess}`);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className='min-h-screen relative'>
        <AnimatedBackground />
        <div className='max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8 relative z-10'>
          <div className='mb-8'>
            <Title order={1} className='text-3xl font-bold text-white mb-2'>
              Procesos
            </Title>
            <Text className='text-white/80'>Cargando procesos disponibles...</Text>
          </div>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing='lg'>
            <ProcessSkeleton count={6} />
          </SimpleGrid>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className='min-h-screen relative'>
      <AnimatedBackground />

      <div className='max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8 relative z-10'>
        {/* Page Header */}
        <div className='mb-8'>
          <Title order={1} className='text-3xl font-bold text-black mb-6'>
            Procesos
          </Title>
          <Text className='text-white/80 mb-8'>Lista de procesos disponibles para tu usuario</Text>

          {/* Search and Filters */}
          <ProcessSearch
            value={searchTerm}
            onChange={setSearchTerm}
            onFilterClick={() => setFiltersOpen(!filtersOpen)}
            loading={loading}
          />
        </div>

        {/* Filters */}
        <ProcessFilters
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          className='mb-6'
        />

        {/* View Controls */}
        <Group justify='space-between' mb='md'>
          <Text size='sm' c='white/80'>
            {filteredProcesses.length} {filteredProcesses.length === 1 ? 'proceso' : 'procesos'}{' '}
            encontrado{filteredProcesses.length !== 1 ? 's' : ''}
          </Text>

          <Group gap='xs'>
            <ActionIcon
              variant={viewMode === 'grid' ? 'filled' : 'light'}
              color='blue'
              onClick={() => setViewMode('grid')}
              style={{ backgroundColor: viewMode === 'grid' ? '#667eea' : 'transparent' }}
            >
              <IconLayoutGrid size={16} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === 'list' ? 'filled' : 'light'}
              color='blue'
              onClick={() => setViewMode('list')}
              style={{ backgroundColor: viewMode === 'list' ? '#667eea' : 'transparent' }}
            >
              <IconList size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {/* Error State */}
        {error && (
          <Alert icon={<IconX size={16} />} title='Error' color='red' mb='md'>
            {error}
          </Alert>
        )}

        {/* Empty State */}
        {filteredProcesses.length === 0 && !error ? (
          <GlassCard className='text-center py-12'>
            <div className='empty-state'>
              <div className='empty-state-icon'>📁</div>
              <Title order={3} className='text-gray-500 mb-2'>
                {searchTerm || selectedCategory
                  ? 'No se encontraron procesos'
                  : 'No hay procesos disponibles'}
              </Title>
              <Text className='text-gray-400 mb-4'>
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
          /* Process Grid/List */
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
