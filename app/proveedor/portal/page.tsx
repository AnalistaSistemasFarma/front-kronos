'use client';

import { useCallback, useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconLogout, IconRefresh } from '@tabler/icons-react';

interface SupplierRequest {
  id: number;
  subject: string | null;
  description: string | null;
  created_at: string | null;
  date_resolution: string | null;
  status: string | null;
  company: string | null;
  category: string | null;
  process: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function SupplierPortal() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [requests, setRequests] = useState<SupplierRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSupplier = session?.user?.role === 'supplier';

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proveedor/solicitudes', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        router.push('/proveedor/login');
        return;
      }
      if (!res.ok) throw new Error('No se pudo cargar la información.');
      const data = await res.json();
      setRequests(Array.isArray(data.solicitudes) ? data.solicitudes : []);
    } catch {
      setError('No se pudo cargar su información. Por favor, intente de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated' || !isSupplier) {
      router.push('/proveedor/login');
      return;
    }
    loadRequests();
  }, [status, isSupplier, router, loadRequests]);

  if (status === 'loading' || (loading && requests.length === 0 && !error)) {
    return (
      <Container size='sm' py='xl' style={{ textAlign: 'center' }}>
        <Loader />
        <Text mt='md' c='dimmed'>
          Cargando su información...
        </Text>
      </Container>
    );
  }

  return (
    <Container size='lg' py='xl'>
      <Group justify='space-between' align='flex-start' mb='lg' wrap='wrap'>
        <div>
          <Title order={2} style={{ color: '#113562' }}>
            Portal de Proveedores
          </Title>
          <Text c='dimmed' size='sm'>
            Bienvenido, {session?.user?.name || 'proveedor'}.
            {session?.user?.nit ? ` NIT ${session.user.nit}.` : ''}
          </Text>
        </div>
        <Group>
          <Button
            variant='light'
            leftSection={<IconRefresh size={16} />}
            onClick={loadRequests}
            loading={loading}
          >
            Actualizar
          </Button>
          <Button
            variant='outline'
            color='red'
            leftSection={<IconLogout size={16} />}
            onClick={() => signOut({ callbackUrl: '/proveedor/login' })}
          >
            Cerrar sesión
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' mb='md' role='alert'>
          {error}
        </Alert>
      )}

      <Card withBorder radius='md' shadow='sm'>
        <Title order={4} mb='md' style={{ color: '#113562' }}>
          Mis solicitudes
        </Title>

        {requests.length === 0 && !loading ? (
          <Text c='dimmed' py='md'>
            Por ahora no tiene solicitudes registradas.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table striped highlightOnHover verticalSpacing='sm'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Proceso</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {requests.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>{r.id}</Table.Td>
                    <Table.Td>{r.subject || '—'}</Table.Td>
                    <Table.Td>{r.process || r.category || '—'}</Table.Td>
                    <Table.Td>{r.company || '—'}</Table.Td>
                    <Table.Td>
                      <Badge variant='light'>{r.status || '—'}</Badge>
                    </Table.Td>
                    <Table.Td>{formatDate(r.created_at)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </Container>
  );
}
