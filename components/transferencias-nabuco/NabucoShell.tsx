'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Breadcrumbs, Card, Group, Loader, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconChevronRight, IconTruckDelivery } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { NABUCO_ADMIN_NAME, NABUCO_MODULE_NAME } from '../../lib/transferencias-nabuco/constants';
import type { NabucoCompany } from './client';

/**
 * Marco de las páginas de Transferencias Nabuco (mismo lineamiento que Vitrina y Bitácora
 * de Proceso): miga de pan, título con icono, selector de empresa y control de permisos.
 */
const STORAGE_KEY = 'nabuco:empresa';

type Estado = { tipo: 'cargando' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; companies: NabucoCompany[] };

export default function NabucoShell({ requireAdmin, children }: { requireAdmin?: boolean; children: (c: NabucoCompany) => ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetch('/api/transferencias-nabuco', { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { companies?: NabucoCompany[]; error?: string };
        if (!res.ok) throw new Error(body.error || (res.status === 401 ? 'Su sesión expiró.' : 'No se pudo cargar el acceso.'));
        return body.companies ?? [];
      })
      .then((all) => {
        if (!activo) return;
        const companies = requireAdmin ? all.filter((c) => c.canAdministrar) : all;
        setEstado({ tipo: 'listo', companies });
        let pref: string | null = null;
        try {
          pref = window.sessionStorage.getItem(STORAGE_KEY);
        } catch {
          /* sin almacenamiento */
        }
        const match = companies.find((c) => String(c.idCompany) === pref) ?? companies[0];
        if (match) setCompanyId(String(match.idCompany));
      })
      .catch((e: unknown) => activo && setEstado({ tipo: 'error', mensaje: e instanceof Error ? e.message : String(e) }));
    return () => {
      activo = false;
    };
  }, [requireAdmin]);

  const company = useMemo(() => (estado.tipo === 'listo' ? (estado.companies.find((c) => String(c.idCompany) === companyId) ?? null) : null), [estado, companyId]);
  const title = requireAdmin ? NABUCO_ADMIN_NAME : NABUCO_MODULE_NAME;

  if (estado.tipo === 'cargando') {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }
  if (estado.tipo === 'error') {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title={NABUCO_MODULE_NAME} m='md'>
        {estado.mensaje}
      </Alert>
    );
  }
  if (!company) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title={title} m='md'>
        {`No tiene acceso a ${title}: le falta el permiso «${title}» en alguna empresa. Lo asigna un administrador en Administración → Usuarios.`}
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
              <Title order={1} fz={{ base: 26, sm: 30 }} className='font-bold mb-1 flex items-center gap-3'>
                <IconTruckDelivery size={28} style={{ flexShrink: 0, color: 'var(--mantine-primary-color-filled)' }} />
                {title}
              </Title>
              <Text size='md' c='dimmed'>
                {`Envío de documentos de SAP a Nabuco WMS de ${company.companyName.trim()}`}
              </Text>
            </div>
            {estado.companies.length > 1 && (
              <SgcSelect
                label='Empresa'
                size='md'
                data={estado.companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
                value={companyId}
                onChange={(v: string | null) => {
                  setCompanyId(v);
                  try {
                    if (v) window.sessionStorage.setItem(STORAGE_KEY, v);
                  } catch {
                    /* sin almacenamiento */
                  }
                }}
                allowDeselect={false}
                w={{ base: '100%', sm: 240 }}
              />
            )}
          </Group>
        </Card>
        {children(company)}
      </div>
    </div>
  );
}
