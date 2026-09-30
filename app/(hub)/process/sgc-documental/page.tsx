'use client';

import React from 'react';
import { SimpleGrid, Tabs, Text } from '@mantine/core';
import {
  IconBook2,
  IconChecklist,
  IconFileCertificate,
  IconFilePlus,
  IconFileUpload,
  IconHierarchy2,
  IconListDetails,
  IconSettings,
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
