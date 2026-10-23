'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Breadcrumbs, Card, Group, Loader, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconBuildingStore, IconChevronRight } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { VITRINA_GESTION_NAME, VITRINA_MODULE_NAME } from '../../lib/vitrina/constants';
import type { CompanyAccess } from './types';

/**
 * Marco común de las páginas de la Vitrina Comercial (línea SynerLink, igual que
 * Bitácora de Proceso y el SGC): miga de pan, título, empresa y permisos.
 * Celular primero: una sola columna; el encabezado se compacta en pantallas angostas.
 * La empresa elegida define qué SAP y qué catálogo se ven: Farmalógica y Ryan no se mezclan.
 */
const STORAGE_KEY = 'vitrina:empresa';

type Estado = { tipo: 'cargando' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; companies: CompanyAccess[] };

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

export interface VitrinaShellProps {
  /** Título de la página (también último eslabón de la miga). */
  title: string;
  subtitle: (company: CompanyAccess) => string;
  requireGestion?: boolean;
  actions?: (company: CompanyAccess) => ReactNode;
  children: (company: CompanyAccess) => ReactNode;
}

export default function VitrinaShell({ title, subtitle, requireGestion, actions, children }: VitrinaShellProps) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [companyId, setCompanyIdState] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetch('/api/vitrina', { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { companies?: CompanyAccess[]; error?: string };
        if (!res.ok) throw new Error(body.error || (res.status === 401 ? 'Su sesión expiró.' : 'No se pudo cargar el acceso.'));
        return body.companies ?? [];
      })
      .then((all) => {
        if (!activo) return;
        const companies = requireGestion ? all.filter((c) => c.canGestionar) : all;
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
  }, [requireGestion]);

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
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title={VITRINA_MODULE_NAME} m='md'>
        {estado.mensaje}
      </Alert>
    );
  }
  if (!company) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title={title} m='md' data-testid='vitrina-sin-acceso'>
        {requireGestion
          ? `No tiene acceso a ${VITRINA_GESTION_NAME}: le falta ese permiso en alguna empresa. Lo asigna un administrador en Administración → Usuarios.`
          : `No tiene acceso a ${VITRINA_MODULE_NAME}: le falta el permiso «${VITRINA_MODULE_NAME}» en alguna empresa. Lo asigna un administrador en Administración → Usuarios.`}
      </Alert>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-3 sm:py-8 px-3 sm:px-6 lg:px-8'>
        <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} mb='sm' style={{ flexWrap: 'wrap' }}>
            <Anchor component={Link} href='/process'>
              Procesos
            </Anchor>
            <Text>{title}</Text>
          </Breadcrumbs>
          <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
            <div style={{ minWidth: 0 }}>
              <Title order={1} fz={{ base: 26, sm: 30 }} className='font-bold mb-1 flex items-center gap-3' data-testid='vitrina-titulo'>
                <IconBuildingStore size={28} style={{ flexShrink: 0, color: 'var(--mantine-primary-color-filled)' }} />
                {title}
              </Title>
              <Text size='md' c='dimmed'>
                {subtitle(company)}
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
                  data-testid='vitrina-empresa'
                />
              )}
              {actions?.(company)}
            </Group>
          </Group>
        </Card>
        {children(company)}
      </div>
    </div>
  );
}
