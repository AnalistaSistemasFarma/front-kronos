'use client';

import Link from 'next/link';
import { Anchor, Breadcrumbs, Button, Card, Group, Text, Title } from '@mantine/core';
import MisBorradores from './MisBorradores';
import { IconChevronRight, IconFileInvoice, IconRobot, IconPlus } from '@tabler/icons-react';

/**
 * Ventas (entrada del menú «Ventas · Ofertas»). Las ofertas se crean como solicitud en
 * «Mis solicitudes» y se siguen en su flujo; la bandeja de ofertas llega en la siguiente entrega.
 */
export default function VentasPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-3 sm:py-8 px-3 sm:px-6 lg:px-8'>
        <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} mb='sm'>
            <Anchor component={Link} href='/process'>Procesos</Anchor>
            <Text>Ventas · Ofertas</Text>
          </Breadcrumbs>
          <Title order={1} fz={{ base: 26, sm: 30 }} className='font-bold mb-1 flex items-center gap-3'>
            <IconFileInvoice size={28} style={{ color: 'var(--mantine-primary-color-filled)' }} />
            Ventas · Ofertas
          </Title>
          <Text c='dimmed' mb='md'>
            La oferta de venta se crea como una solicitud en «Mis solicitudes» (proceso «Oferta de venta»). El flujo revisa precio y cupo, pide las autorizaciones y crea el pedido en SAP.
          </Text>
          <Group>
            <Button component={Link} href='/process/request-general/create-request' leftSection={<IconPlus size={16} />}>
              Crear oferta en Mis solicitudes
            </Button>
            <Button component={Link} href='/process/sales/pedidos' variant='light' leftSection={<IconFileInvoice size={16} />}>
              Pedidos de venta
            </Button>
            <Button component={Link} href='/process/sales/automatizacion' variant='light' leftSection={<IconRobot size={16} />}>
              Automatización de Salesforce
            </Button>
          </Group>
        </Card>
        <MisBorradores />
      </div>
    </div>
  );
}
