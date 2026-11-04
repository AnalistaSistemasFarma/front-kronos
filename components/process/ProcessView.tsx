'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, Button, Group, ActionIcon, SimpleGrid } from '@mantine/core';
import {
  IconLayoutGrid,
  IconList,
  IconX,
  IconFolderOff,
  IconArrowsMinimize,
  IconArrowsMaximize,
} from '@tabler/icons-react';
import ProcessCard from './ProcessCard';
import ProcessSearch from './ProcessSearch';
import ProcessFilters from './ProcessFilters';
import ProcessSkeleton from './ProcessSkeleton';
import { useProcessData, type ProcessRecord } from '../../lib/process/ProcessDataContext';
import { isHubHiddenRequestDashboardSubprocess } from '../../lib/request-general/dashboardRoutes';
import {
  buildUsageIndex,
  normalizeUsageEntries,
  readCompressedPreference,
  readLocalUsage,
  recordLocalOpen,
  sortByRecurrence,
  writeCompressedPreference,
  writeLocalUsage,
  type SubprocessUsage,
} from '../../lib/process/processUsage';

const USAGE_API = '/api/processes/usage';

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

type Subprocess = ProcessRecord['subprocesses'][number];

function ProcessViewInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const { processes, loading, error, fetchProcesses } = useProcessData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [compressed, setCompressed] = useState(false);
  const [usage, setUsage] = useState<SubprocessUsage[]>([]);

  const userKey =
    (session?.user as { id?: string } | undefined)?.id ||
    session?.user?.email ||
    '';

  useEffect(() => {
    setCompressed(readCompressedPreference());
  }, []);

  const pathname = usePathname();

  // Al entrar (o volver) a Procesos: primero la copia del navegador (pinta sin esperar) y
  // luego el servidor, que es igual en cualquier equipo. Sin tabla en el servidor queda la copia.
  useEffect(() => {
    if (!userKey) {
      setUsage([]);
      return;
    }
    setUsage(readLocalUsage(userKey));
    let cancelled = false;
    fetch(USAGE_API, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { available?: boolean; entries?: unknown } | null) => {
        if (cancelled || !data?.available) return;
        const entries = normalizeUsageEntries(data.entries);
        writeLocalUsage(userKey, entries);
        setUsage(entries);
      })
      .catch(() => {
        /* sin red: queda la copia del navegador */
      });
    return () => {
      cancelled = true;
    };
  }, [userKey, pathname]);

  const usageIndex = useMemo(() => buildUsageIndex(usage), [usage]);

  // El color de cada tarjeta va con el proceso (orden de siempre), no con su puesto:
  // si un proceso sube por uso, conserva su color.
  const colorIndexById = useMemo(() => {
    const map = new Map<number, number>();
    processes.forEach((process, index) => map.set(process.id_process, index));
    return map;
  }, [processes]);

  const enhancedProcesses = useMemo(() => {
    const visible = processes
      .map((process) => {
        // Dentro del proceso: los accesos que más abre arriba; en empate, el orden de siempre.
        const subprocesses = sortByRecurrence(
          process.subprocesses.filter((sub) => !isHubHiddenRequestDashboardSubprocess(sub)),
          (sub) => usageIndex.bySubprocess.get(sub.id_subprocess)
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
    // Proceso completo: el que más abre primero (desde MIN_USES_TO_PROMOTE aperturas).
    // En empate se conserva el orden de siempre: abrir algo una vez o de último no lo sube.
    return sortByRecurrence(visible, (process) => usageIndex.byProcess.get(process.id_process));
  }, [processes, usageIndex]);

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

  const setCompressedAndPersist = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setCompressed((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      writeCompressedPreference(value);
      return value;
    });
  }, []);

  const navigateToSubprocess = useCallback(
    (subprocess: Subprocess) => {
      if (subprocess.subprocess_url) {
        router.push(subprocess.subprocess_url);
      } else {
        router.push(`/process/help-desk/create-ticket?subprocess_id=${subprocess.id_subprocess}`);
      }
    },
    [router]
  );

  const handleSubprocessClick = useCallback(
    (subprocess: Subprocess, parent: { id_process: number; process: string }) => {
      // Navega primero; el uso se guarda sin reordenar la pantalla actual (si no, la tarjeta
      // salta arriba antes de abrir). El nuevo orden se ve al volver a Procesos.
      navigateToSubprocess(subprocess);
      const ids = { id_subprocess: subprocess.id_subprocess, id_process: parent.id_process };
      if (userKey) recordLocalOpen(userKey, ids);
      // keepalive: el aviso al servidor sobrevive aunque la página cambie de inmediato.
      fetch(USAGE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_subprocess: ids.id_subprocess }),
        keepalive: true,
      }).catch(() => {
        /* si falla, queda contado en el navegador */
      });
    },
    [userKey, navigateToSubprocess]
  );

  if (!session) {
    return null;
  }

  const firstName = session.user?.name?.split(' ')[0] || '';
  const searching = Boolean(searchTerm.trim());

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
            Elige un módulo para empezar. Los procesos que más abres van quedando primero.
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

          <Group gap={6}>
            <button
              type='button'
              className={`ios-segment ${compressed ? 'ios-segment--active' : ''}`}
              onClick={() => setCompressedAndPersist((v) => !v)}
              aria-pressed={compressed}
              title={
                compressed
                  ? 'Mostrar de nuevo todas las listas abiertas'
                  : 'Comprimir procesos: solo el título; tócalo para ver los accesos'
              }
            >
              {compressed ? <IconArrowsMaximize size={16} aria-hidden /> : <IconArrowsMinimize size={16} aria-hidden />}
              {compressed ? 'Expandir' : 'Comprimir'}
            </button>
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
            <Button
              size='xs'
              variant='light'
              color='red'
              mt='sm'
              onClick={() => void fetchProcesses({ silent: false })}
            >
              Reintentar
            </Button>
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
          <div className='flex flex-col gap-3 ios-process-hub__grid'>
            {filteredProcesses.map((process, index) => (
              <ProcessCard
                key={process.id_process}
                process={process}
                colorIndex={colorIndexById.get(process.id_process) ?? index}
                compressed={compressed}
                forceExpanded={searching}
                onProcessClick={handleProcessClick}
                onSubprocessClick={(sub) =>
                  handleSubprocessClick(sub, {
                    id_process: process.id_process,
                    process: process.process,
                  })
                }
              />
            ))}
          </div>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='lg' className='ios-process-hub__grid'>
            {filteredProcesses.map((process, index) => (
              <ProcessCard
                key={process.id_process}
                process={process}
                colorIndex={colorIndexById.get(process.id_process) ?? index}
                compressed={compressed}
                forceExpanded={searching}
                onProcessClick={handleProcessClick}
                onSubprocessClick={(sub) =>
                  handleSubprocessClick(sub, {
                    id_process: process.id_process,
                    process: process.process,
                  })
                }
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
