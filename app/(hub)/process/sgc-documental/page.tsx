'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconBook2,
  IconChecklist,
  IconChevronRight,
  IconFileCertificate,
  IconFilePlus,
  IconHierarchy2,
  IconListDetails,
  IconShieldCheck,
} from '@tabler/icons-react';
import SgcModuleCard from '../../../../components/sgc/SgcModuleCard';
import type { SgcCompanyAccess } from '../../../../lib/sgc/permissions';

/**
 * SGC documental — página de entrada (esqueleto del Sprint 0).
 *
 * Módulo AISLADO del Sistema de Gestión de Calidad: ruta, APIs (/api/sgc/**),
 * tablas (esquema SQL `sgc`) y permisos propios. Se recorre como el sistema de
 * referencia (pestañas por dimensión del SGC y tablero de accesos), pero con
 * la línea de diseño GSS/SynerLink. Solo ve el módulo quien tenga el permiso
 * en una empresa ACTIVA en el SGC (al inicio, solo One Latam Pharma).
 */

const DIMENSIONES = [
  { value: 'documentos', label: 'Documentos', enabled: true },
  { value: 'cambios', label: 'Control de cambios', enabled: false },
  { value: 'mejora', label: 'Mejora (CAPA)', enabled: false },
  { value: 'auditoria', label: 'Auditoría', enabled: false },
  { value: 'capacitacion', label: 'Capacitación', enabled: false },
] as const;

const ACCESOS_DOCUMENTOS = [
  {
    title: 'Listado maestro',
    description: 'Documentos vigentes por área y proceso, con código y versión siempre visibles.',
    icon: <IconListDetails size={24} />,
    sprint: 'Sprint 1',
  },
  {
    title: 'Mapa de procesos',
    description: 'Tipo de proceso → proceso → tipo documental → documento.',
    icon: <IconHierarchy2 size={24} />,
    sprint: 'Sprint 1',
  },
  {
    title: 'Manuales',
    description: 'Manual de calidad y manuales de cada área, en visor de solo consulta.',
    icon: <IconBook2 size={24} />,
    sprint: 'Sprint 1',
  },
  {
    title: 'Solicitudes documentales',
    description: 'Nuevo documento, nueva versión, modificación o anulación.',
    icon: <IconFilePlus size={24} />,
    sprint: 'Sprint 2',
  },
  {
    title: 'Tareas documentales',
    description: 'Elaboración, revisión y aprobación, igual que una tarea de SynerLink.',
    icon: <IconChecklist size={24} />,
    sprint: 'Sprint 2',
  },
  {
    title: 'Firma electrónica del SGC',
    description: 'Elaboró, revisó y aprobó con reautenticación, motivo y sello de tiempo.',
    icon: <IconFileCertificate size={24} />,
    sprint: 'Sprint 3',
  },
];

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; companies: SgcCompanyAccess[] };

function permisosVisibles(access: SgcCompanyAccess): string[] {
  const out: string[] = [];
  if (access.canRead) out.push('Consulta');
  if (access.canManage) out.push('Gestión');
  if (access.canQuality) out.push('Calidad');
  if (access.canAdminFlows) out.push('Flujos validados');
  return out;
}

export default function SgcDocumentalPage() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetch('/api/sgc/access', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? 'Su sesión expiró.' : 'No se pudo cargar el acceso.');
        return (await res.json()) as { companies: SgcCompanyAccess[] };
      })
      .then((data) => {
        if (!activo) return;
        setEstado({ tipo: 'listo', companies: data.companies });
        if (data.companies[0]) setCompanyId(String(data.companies[0].idCompany));
      })
      .catch((err: unknown) => {
        if (activo) setEstado({ tipo: 'error', mensaje: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      activo = false;
    };
  }, []);

  const empresa = useMemo(() => {
    if (estado.tipo !== 'listo') return null;
    return estado.companies.find((c) => String(c.idCompany) === companyId) ?? null;
  }, [estado, companyId]);

  if (estado.tipo === 'cargando') {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }

  if (estado.tipo === 'error') {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title='SGC documental' mt='md'>
        {estado.mensaje}
      </Alert>
    );
  }

  if (estado.companies.length === 0 || !empresa) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='SGC documental' mt='md' data-testid='sgc-sin-acceso'>
        No tiene acceso al Sistema de Gestión de Calidad documental en ninguna empresa activa.
      </Alert>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='lg'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            <Anchor component={Link} href='/process'>
              Procesos
            </Anchor>
            <Text>SGC documental</Text>
          </Breadcrumbs>

          <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3' data-testid='sgc-titulo'>
                <IconShieldCheck size={32} className='text-blue-600' />
                Sistema de Gestión de Calidad
              </Title>
              <Text size='lg' c='dimmed'>
                Gestión documental del sistema validado de {empresa.companyName}
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
                {permisosVisibles(empresa).map((p) => (
                  <Badge key={p} variant='light'>
                    {p}
                  </Badge>
                ))}
              </Group>
            </Group>
          </Group>
        </Card>

        <Tabs defaultValue='documentos' keepMounted={false}>
          <Tabs.List mb='lg'>
            {DIMENSIONES.map((d) => (
              <Tabs.Tab key={d.value} value={d.value} disabled={!d.enabled}>
                {d.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Tabs.Panel value='documentos'>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='lg'>
              {ACCESOS_DOCUMENTOS.map((a) => (
                <SgcModuleCard key={a.title} {...a} />
              ))}
            </SimpleGrid>
            <Text size='xs' c='dimmed' mt='lg'>
              Módulo en construcción por sprints. Las demás dimensiones del SGC se habilitan con los
              siguientes flujos validados.
            </Text>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
