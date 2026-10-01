'use client';

import React from 'react';
import { SimpleGrid, Tabs, Text } from '@mantine/core';
import {
  IconBook2,
  IconCalendarDue,
  IconChecklist,
  IconFileCertificate,
  IconFilePlus,
  IconFileUpload,
  IconGitBranch,
  IconHierarchy2,
  IconKey,
  IconListDetails,
  IconTopologyStar3,
  IconSettings,
  IconShieldCheck,
} from '@tabler/icons-react';
import SgcModuleCard, { type SgcModuleCardProps } from '../../../../components/sgc/SgcModuleCard';
import SgcShell from '../../../../components/sgc/SgcShell';
import { sgcHref } from '../../../../components/sgc/useSgcCompany';
import { SGC_BASE_URL } from '../../../../lib/sgc/constants';
import type { SgcCompanyAccess } from '../../../../lib/sgc/permissions';

/**
 * SGC documental — página de entrada (tablero de accesos).
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

function accesosDocumentos(company: SgcCompanyAccess): SgcModuleCardProps[] {
  const id = company.idCompany;
  const cards: SgcModuleCardProps[] = [
    {
      title: 'Listado maestro',
      description: 'Documentos vigentes por área y proceso, con código y versión siempre visibles.',
      icon: <IconListDetails size={24} />,
      sprint: 'Sprint 1',
      href: sgcHref(`${SGC_BASE_URL}/listado`, id),
    },
    {
      title: 'Mapa de procesos',
      description: 'Tipo de proceso → proceso → tipo documental → documento.',
      icon: <IconHierarchy2 size={24} />,
      sprint: 'Sprint 1',
      href: sgcHref(`${SGC_BASE_URL}/mapa`, id),
    },
    {
      title: 'Manuales',
      description: 'Manual de calidad y manuales de cada área, en visor de solo consulta.',
      icon: <IconBook2 size={24} />,
      sprint: 'Sprint 1',
      href: sgcHref(`${SGC_BASE_URL}/listado`, id, { tipo: 'MA' }),
    },
    {
      title: 'Mapa de relaciones',
      description: 'Documentos conectados (procedimiento padre, formatos, anexos, referencias) en un mapa que se arrastra y acerca.',
      icon: <IconTopologyStar3 size={24} />,
      sprint: 'Sprint 5',
      href: sgcHref(`${SGC_BASE_URL}/relaciones`, id),
    },
    {
      title: 'Calendario de vencimientos',
      description: 'Próximos vencimientos de la vigencia, avisos anticipados y «Mis vencimientos».',
      icon: <IconCalendarDue size={24} />,
      sprint: 'Sprint 5',
      href: sgcHref(`${SGC_BASE_URL}/vencimientos`, id),
    },
    {
      title: 'Solicitudes de acceso',
      description: 'Pida consultar un documento de otra área, con justificación.',
      icon: <IconKey size={24} />,
      sprint: 'Sprint 5',
      href: sgcHref(`${SGC_BASE_URL}/accesos`, id),
      ...(company.canQuality ? { badge: 'Calidad decide' } : {}),
    },
  ];
  if (company.canQuality) {
    cards.push(
      {
        title: 'Carga de documentos vigentes',
        description: 'Alta administrativa de los documentos vigentes con su PDF controlado.',
        icon: <IconFileUpload size={24} />,
        sprint: 'Sprint 1',
        href: sgcHref(`${SGC_BASE_URL}/carga`, id),
        badge: 'Calidad',
      },
      {
        title: 'Configuración del SGC',
        description: 'Guía de codificación, tipos de proceso, procesos y tipos documentales.',
        icon: <IconSettings size={24} />,
        sprint: 'Sprint 1',
        href: sgcHref(`${SGC_BASE_URL}/configuracion`, id),
        badge: 'Calidad',
      }
    );
  }
  cards.push(
    {
      title: 'Solicitudes documentales',
      description: 'Nuevo documento, nueva versión o modificación de un vigente.',
      icon: <IconFilePlus size={24} />,
      sprint: 'Sprint 2',
      href: sgcHref(`${SGC_BASE_URL}/solicitudes`, id),
    },
    {
      title: 'Tareas documentales',
      description: 'Elaboración, revisión y aprobación, igual que una tarea de SynerLink.',
      icon: <IconChecklist size={24} />,
      sprint: 'Sprint 2',
      href: sgcHref(`${SGC_BASE_URL}/tareas`, id),
    },
    {
      title: 'Autorizaciones SGC',
      description: 'Aprobaciones y verificación de Calidad, con su propio registro.',
      icon: <IconShieldCheck size={24} />,
      sprint: 'Sprint 2',
      href: sgcHref(`${SGC_BASE_URL}/autorizaciones`, id),
    },
    ...(company.canAdminFlows || company.canQuality
      ? [
          {
            title: 'Administración de flujos validados',
            description: 'Flujos, versiones, matriz de responsables y registro de cambios.',
            icon: <IconGitBranch size={24} />,
            sprint: 'Sprint 2',
            href: sgcHref(`${SGC_BASE_URL}/flujos`, id),
            badge: company.canAdminFlows ? 'Flujos' : 'Calidad',
          },
        ]
      : []),
    {
      title: 'Firma electrónica del SGC',
      description: company.canQuality
        ? 'Maestro de firmas de la inducción; se firma en cada tarea con reautenticación, motivo y sello de tiempo.'
        : 'Elaboró, revisó y aprobó se firman en la tarea con su contraseña, motivo y sello de tiempo.',
      icon: <IconFileCertificate size={24} />,
      sprint: 'Sprint 3',
      href: sgcHref(`${SGC_BASE_URL}/${company.canQuality ? 'firmas' : 'tareas'}`, id),
      ...(company.canQuality ? { badge: 'Calidad' } : {}),
    }
  );
  return cards;
}

export default function SgcDocumentalPage() {
  return (
    <SgcShell>
      {(company) => (
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
              {accesosDocumentos(company).map((a) => (
                <SgcModuleCard key={a.title} {...a} />
              ))}
            </SimpleGrid>
            <Text size='xs' c='dimmed' mt='lg'>
              Módulo en construcción por sprints. Las demás dimensiones del SGC se habilitan con los
              siguientes flujos validados.
            </Text>
          </Tabs.Panel>
        </Tabs>
      )}
    </SgcShell>
  );
}
