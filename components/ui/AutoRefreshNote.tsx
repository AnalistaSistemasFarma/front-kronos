'use client';

import { Group, Loader, Text } from '@mantine/core';

/** "Se actualiza sola · última vez 10:42:15", con un circulito mientras consulta. */
export default function AutoRefreshNote({
  refreshing,
  lastUpdated,
}: {
  refreshing: boolean;
  lastUpdated: Date | null;
}) {
  return (
    <Group gap={6} wrap='nowrap'>
      {refreshing ? <Loader size={12} /> : null}
      <Text size='xs' c='dimmed'>
        {lastUpdated
          ? `Se actualiza sola · última vez ${lastUpdated.toLocaleTimeString('es-CO', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}`
          : 'Se actualiza sola cada 30 s'}
      </Text>
    </Group>
  );
}
