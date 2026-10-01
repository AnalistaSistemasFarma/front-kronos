'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Badge, Breadcrumbs, Card, Group, Loader, Select, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconChevronRight, IconShieldCheck } from '@tabler/icons-react';
import { SGC_BASE_URL } from '../../lib/sgc/constants';
import type { SgcCompanyAccess } from '../../lib/sgc/permissions';
import { sgcHref, useSgcCompany } from './useSgcCompany';

/**
 * Marco común de las páginas del SGC documental (línea GSS/SynerLink):
 * migas, título, empresa y permisos. Resuelve el acceso (dos llaves) y solo
 * muestra el contenido si la persona tiene acceso a una empresa activa (y,
 * con `requireQuality`, si es de Aseguramiento de Calidad).
 */
export interface SgcShellProps {
  section?: string;
  subtitle?: string;
  requireQuality?: boolean;
  actions?: (company: SgcCompanyAccess) => ReactNode;
  children: (company: SgcCompanyAccess) => ReactNode;
}

export function permisosVisibles(access: SgcCompanyAccess): string[] {
  const out: string[] = [];
  if (access.canRead) out.push('Consulta');
  if (access.canManage) out.push('Gestión');
  if (access.canQuality) out.push('Calidad');
  if (access.canAdminFlows) out.push('Flujos validados');
  return out;
}

export default function SgcShell({ section, subtitle, requireQuality, actions, children }: SgcShellProps) {
  const { estado, company, companyId, setCompanyId } = useSgcCompany();

  if (estado.tipo === 'cargando') {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }

  if (estado.tipo === 'error') {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title='Documentos' mt='md'>
        {estado.mensaje}
      </Alert>
    );
  }

  if (estado.companies.length === 0 || !company) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Documentos' mt='md' data-testid='sgc-sin-acceso'>
        No tiene acceso a Documentos en ninguna empresa activa.
      </Alert>
    );
  }

  const denied = requireQuality && !company.canQuality;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='lg'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            <Anchor component={Link} href='/process'>
              Procesos
            </Anchor>
            {section ? (
              <Anchor component={Link} href={sgcHref(SGC_BASE_URL, company.idCompany)}>
                Documentos
              </Anchor>
            ) : (
              <Text>Documentos</Text>
            )}
            {section && <Text>{section}</Text>}
          </Breadcrumbs>

          <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3' data-testid='sgc-titulo'>
                <IconShieldCheck size={32} className='text-blue-600' />
                {section ?? 'Documentos'}
              </Title>
              <Text size='lg' c='dimmed'>
                {subtitle ?? 'Gestión documental del sistema validado'}
              </Text>
            </div>
            <Group gap='sm' align='flex-end'>
              {estado.companies.length > 1 && (
                <Select
                  label='Empresa'
                  data={estado.companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
                  value={companyId}
                  onChange={setCompanyId}
                  allowDeselect={false}
                  w={240}
                />
              )}
              <Group gap={6}>
                {permisosVisibles(company).map((p) => (
                  <Badge key={p} variant='light'>
                    {p}
                  </Badge>
                ))}
              </Group>
              {!denied && actions?.(company)}
            </Group>
          </Group>
        </Card>

        {denied ? (
          <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Solo Aseguramiento de Calidad' data-testid='sgc-solo-calidad'>
            Esta sección es exclusiva de Aseguramiento de Calidad.
          </Alert>
        ) : (
          children(company)
        )}
      </div>
    </div>
  );
}
