'use client';

import Link from 'next/link';
import { Button, Card, Group, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconSettings, IconTools } from '@tabler/icons-react';
import { VITRINA_GESTION_NAME, VITRINA_GESTION_URL, vitrinaHref } from '../../lib/vitrina/constants';
import type { CompanyAccess } from './types';

/** Pantalla mínima del V2 para los comerciales: el catálogo aún está en construcción. */
export default function VitrinaEnConstruccion({ company }: { company: CompanyAccess }) {
  return (
    <Card withBorder radius='md' p={{ base: 'md', sm: 'xl' }} data-testid='vitrina-en-construccion'>
      <Stack gap='md' align='flex-start'>
        <ThemeIcon size={52} radius='md' variant='light'>
          <IconTools size={28} />
        </ThemeIcon>
        <Title order={2} size='h3'>
          El catálogo está en construcción
        </Title>
        <Text c='dimmed'>
          Los administradores están revisando y validando las presentaciones de {company.companyName.trim()} a partir de SAP. Cuando el catálogo esté listo,
          aquí verá las fichas de los productos, con su registro sanitario, áreas asistenciales y documentos aprobados.
        </Text>
        {company.canGestionar && (
          <Group>
            <Button component={Link} href={vitrinaHref(VITRINA_GESTION_URL, company.idCompany)} leftSection={<IconSettings size={18} />} size='md'>
              Ir a {VITRINA_GESTION_NAME}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
