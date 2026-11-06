'use client';

import { Alert, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import type { Alerta } from './types';

/** Alertas vivas para los administradores: registro vencido o por vencer, inactivos en SAP y exclusividades. Los «sin vencimiento» van como información (azul), no como alerta. */
export default function VitrinaAlertas({ alertas, error, loading }: { alertas: Alerta[] | null; error: string | null; loading: boolean }) {
  if (error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error}
      </Alert>
    );
  }
  if (loading && !alertas) {
    return (
      <Group justify='center' py='lg'>
        <Loader />
      </Group>
    );
  }
  if (!alertas || alertas.length === 0) {
    return (
      <Card withBorder radius='md' p='lg'>
        <Text c='dimmed'>Sin alertas. Las alertas aparecen cuando un código asignado tiene el registro vencido o por vencer, SAP lo inactiva, o una exclusividad vence. Los registros sin vencimiento se listan aquí solo como información.</Text>
      </Card>
    );
  }
  return (
    <Stack gap='sm' data-testid='vitrina-alertas'>
      {alertas.map((a, i) => (
        <Alert
          key={`${a.tipo}-${a.titulo}-${i}`}
          color={a.nivel === 'alerta' ? 'red' : a.nivel === 'aviso' ? 'yellow' : 'blue'}
          variant='light'
          icon={a.nivel === 'alerta' ? <IconAlertTriangle size={18} /> : <IconInfoCircle size={18} />}
          title={a.titulo}
          data-nivel={a.nivel}
        >
          <Text size='sm'>{a.detalle}</Text>
        </Alert>
      ))}
    </Stack>
  );
}
