'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Breadcrumbs, Card, Group, Loader, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconChevronRight, IconListCheck } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { OT_BASE_URL, otNombreCompleto } from '../../lib/bitacora-proceso/constants';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { otHref } from './otClient';

/**
 * Marco común de las páginas de Bitácora de Proceso (línea GSS/SynerLink, igual
 * que el SGC): migas, título, empresa y permisos. Diseño para CELULAR primero:
 * una sola columna, el encabezado se compacta en pantallas angostas.
 */
const STORAGE_KEY = 'bitacora-proceso:empresa';

type Estado = { tipo: 'cargando' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; companies: OtCompanyAccess[] };

function preferida(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URLSearchParams(window.location.search).get('empresa');
  if (url) return url;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export interface OtShellProps {
  section?: string;
  subtitle?: string;
  requireManage?: boolean;
  /** Oculta la tarjeta de encabezado (pantalla de planta e informe tienen el suyo). */
  compact?: boolean;
  actions?: (company: OtCompanyAccess) => ReactNode;
  children: (company: OtCompanyAccess) => ReactNode;
}

export default function OtShell({ section, subtitle, requireManage, compact, actions, children }: OtShellProps) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [companyId, setCompanyIdState] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetch('/api/bitacora-proceso?solo=acceso', { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { companies?: OtCompanyAccess[]; error?: string };
        if (res.status === 403) return { companies: [] as OtCompanyAccess[] };
        if (!res.ok) throw new Error(body.error || (res.status === 401 ? 'Su sesión expiró.' : 'No se pudo cargar el acceso.'));
        return { companies: body.companies ?? [] };
      })
      .then(({ companies }) => {
        if (!activo) return;
        setEstado({ tipo: 'listo', companies });
        const p = preferida();
        const match = companies.find((c) => String(c.idCompany) === p) ?? companies[0];
        if (match) setCompanyIdState(String(match.idCompany));
      })
      .catch((e: unknown) => {
        if (activo) setEstado({ tipo: 'error', mensaje: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      activo = false;
    };
  }, []);

  const setCompanyId = useCallback((v: string | null) => {
    setCompanyIdState(v);
    try {
      if (v) window.sessionStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  const company = useMemo(
    () => (estado.tipo === 'listo' ? (estado.companies.find((c) => String(c.idCompany) === companyId) ?? null) : null),
    [estado, companyId]
  );

  if (estado.tipo === 'cargando') {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }
  if (estado.tipo === 'error') {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title='Bitácora de Proceso' m='md'>
        {estado.mensaje}
      </Alert>
    );
  }
  if (!company) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Bitácora de Proceso' m='md' data-testid='ot-sin-acceso'>
        No tiene acceso a Bitácora de Proceso en ninguna empresa. Pídalo a su supervisor o a TI.
      </Alert>
    );
  }

  const denied = requireManage && !company.canManage;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-3 sm:py-8 px-3 sm:px-6 lg:px-8'>
        {!compact && (
          <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md' className='ot-no-print'>
            <Breadcrumbs separator={<IconChevronRight size={16} />} mb='sm' style={{ flexWrap: 'wrap' }}>
              <Anchor component={Link} href='/process'>
                Procesos
              </Anchor>
              {section ? (
                <Anchor component={Link} href={otHref(OT_BASE_URL, company.idCompany)}>
                  Bitácora de Proceso
                </Anchor>
              ) : (
                <Text>Bitácora de Proceso</Text>
              )}
              {section && <Text>{section}</Text>}
            </Breadcrumbs>
            <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
              <div style={{ minWidth: 0 }}>
                <Title order={1} fz={{ base: 26, sm: 30 }} className='font-bold mb-1 flex items-center gap-3' data-testid='ot-titulo'>
                  <IconListCheck size={28} className='text-blue-600' style={{ flexShrink: 0 }} />
                  {section ?? otNombreCompleto(company.companyName)}
                </Title>
                <Text size='md' c='dimmed'>
                  {subtitle ?? 'Registro de las intervenciones durante el proceso, con la hora del servidor'}
                </Text>
              </div>
              <Group gap='sm' align='flex-end' wrap='wrap' w={{ base: '100%', sm: 'auto' }}>
                {estado.companies.length > 1 && (
                  <SgcSelect
                    label='Empresa'
                    size='md'
                    data={estado.companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
                    value={companyId}
                    onChange={setCompanyId}
                    allowDeselect={false}
                    w={{ base: '100%', sm: 240 }}
                  />
                )}
                {!denied && actions?.(company)}
              </Group>
            </Group>
          </Card>
        )}
        {denied ? (
          <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Solo supervisores' data-testid='ot-solo-gestion'>
            Esta sección es exclusiva del supervisor (permiso Bitácora de Proceso: Gestión).
          </Alert>
        ) : (
          children(company)
        )}
      </div>
    </div>
  );
}
