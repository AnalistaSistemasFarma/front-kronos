'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Loader, Alert, Table, Badge, Group, Text, Anchor } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import Link from 'next/link';
import { isClosedState } from '../../../../../lib/document-management/workflowStates';

interface PendingTask {
  idDocument: number;
  idDocumentVersion: number;
  code: string;
  title: string;
  versionNumber: number;
  companyId: number;
  companyName: string;
  state: string;
  assignedToMe: boolean;
}

function statusColor(status: string): string {
  if (status === 'Vigente') return 'green';
  if (isClosedState(status)) return 'red';
  if (status === 'Reasignación' || status === 'Reelaboración') return 'yellow';
  return 'blue';
}

/**
 * Tareas documentales pendientes de mí: las que me asignaron directamente
 * (dueño en En elaboración/Reelaboración) más las abiertas de cualquier
 * empresa donde tengo permiso de escritura (revisión/aprobación/calidad/
 * divulgación/reasignación no tienen un responsable fijo — cualquiera con
 * escritura las puede tomar).
 */
export default function MyDocumentTasksPage() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/document-management/my-tasks');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las tareas');
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      <Anchor component={Link} href="/process/document-management" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Volver al listado
        </Group>
      </Anchor>

      <h2>Gestión Documental — Mis tareas pendientes</h2>

      {error && <Alert color="red">{error}</Alert>}

      <Table.ScrollContainer minWidth={720}>
        <Table striped highlightOnHover withTableBorder mt="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Código</Table.Th>
              <Table.Th>Título</Table.Th>
              <Table.Th>Versión</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Asignación</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tasks.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={7} style={{ textAlign: 'center' }}>
                  No tiene tareas documentales pendientes.
                </Table.Td>
              </Table.Tr>
            ) : (
              tasks.map((t) => (
                <Table.Tr key={`${t.idDocumentVersion}-${t.state}`}>
                  <Table.Td>
                    <Badge variant="light">{t.companyName}</Badge>
                  </Table.Td>
                  <Table.Td>{t.code}</Table.Td>
                  <Table.Td>{t.title}</Table.Td>
                  <Table.Td>v{t.versionNumber}</Table.Td>
                  <Table.Td>
                    <Badge color={statusColor(t.state)} variant="light">
                      {t.state}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{t.assignedToMe ? 'Asignada a mí' : 'Abierta (cualquiera con gestión)'}</Table.Td>
                  <Table.Td>
                    <Anchor component={Link} href={`/process/document-management/${t.idDocument}`} size="sm">
                      Abrir
                    </Anchor>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Text size="xs" c="dimmed" mt="sm">
        {tasks.length} tarea(s) pendiente(s).
      </Text>
    </div>
  );
}
