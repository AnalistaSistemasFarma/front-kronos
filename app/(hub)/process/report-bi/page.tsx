'use client';

import { Card, Title, Text, Breadcrumbs, Anchor } from '@mantine/core';
import { IconChartBar, IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';

const REPORT_TITLE = 'Tablero Abamia representantes';
const REPORT_SRC =
  'https://app.powerbi.com/view?r=eyJrIjoiNGNlOTAzNDItZjA5YS00MDBhLWE5MDgtNjFhOTdkNWMzNzU2IiwidCI6IjU4ZjE5YTkxLTU4NzEtNDA1ZS1hZGNjLTViNmU5MDZiYjNmNSIsImMiOjR9';

export default function ReportBiPage() {
  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Reporte BI', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-600 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component='span' c='dimmed'>
        {item.title}
      </Text>
    )
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3'>
            <IconChartBar size={32} className='text-blue-600' />
            {REPORT_TITLE}
          </Title>
          <Text size='lg' c='dimmed'>
            Tablero de representantes de Abamia
          </Text>
        </Card>

        <Card shadow='sm' radius='md' withBorder p={0} className='overflow-hidden'>
          <iframe
            title={REPORT_TITLE}
            src={REPORT_SRC}
            allowFullScreen
            style={{
              display: 'block',
              width: '100%',
              height: 'calc(100vh - 220px)',
              minHeight: 600,
              border: 0,
            }}
          />
        </Card>
      </div>
    </div>
  );
}
