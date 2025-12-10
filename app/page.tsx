import Link from 'next/link';
import {
  Button,
  Container,
  Group,
  Stack,
  Title,
  Text,
  Card,
  Grid,
  GridCol,
  Badge,
  SimpleGrid,
  Box,
  Image,
} from '@mantine/core';
import {
  IconBuilding,
  IconArrowRight,
  IconMail,
  IconPhone,
  IconMapPin,
  IconCheck,
} from '@tabler/icons-react';

export default function LandingPage() {
  return (
    <Box style={{ minHeight: '100vh', backgroundColor: '#ffffff' }}>
      {/* Header */}
      <Box
        component='header'
        style={{
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#ffffff',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <Container size='xl' py='md'>
          <Group justify='space-between' align='center'>
            <Link href='/' style={{ textDecoration: 'none' }}>
              <Image
                src='/Logo_Principal.svg'
                alt='ServiciosCompartidos Logo'
                height={40}
                width={120}
                fit='contain'
                className='h-12'
              />
            </Link>

            <Group gap='xl' visibleFrom='md'>
              <Link href='#services' style={{ textDecoration: 'none' }}>
                <Text
                  c='dimmed'
                  fw={500}
                  style={{ cursor: 'pointer', '&:hover': { color: '#1f2937' } }}
                >
                  Servicios
                </Text>
              </Link>
              <Link href='#benefits' style={{ textDecoration: 'none' }}>
                <Text
                  c='dimmed'
                  fw={500}
                  style={{ cursor: 'pointer', '&:hover': { color: '#1f2937' } }}
                >
                  Beneficios
                </Text>
              </Link>
              <Link href='#about' style={{ textDecoration: 'none' }}>
                <Text
                  c='dimmed'
                  fw={500}
                  style={{ cursor: 'pointer', '&:hover': { color: '#1f2937' } }}
                >
                  Nosotros
                </Text>
              </Link>
              <Link href='#contact' style={{ textDecoration: 'none' }}>
                <Text
                  c='dimmed'
                  fw={500}
                  style={{ cursor: 'pointer', '&:hover': { color: '#1f2937' } }}
                >
                  Contacto
                </Text>
              </Link>
            </Group>

            <Group gap='sm'>
              <Button component={Link} href='/login'>
                Iniciar Sesión
              </Button>
            </Group>
          </Group>
        </Container>
      </Box>

      {/* Hero Section */}
      <Box
        style={{
          background: 'linear-gradient(135deg, #113562 0%, #3db6e0 100%)',
          color: 'white',
          padding: '80px 0',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Container size='xl'>
          <Stack align='center' gap='xl' style={{ textAlign: 'center' }}>
            <Badge
              size='lg'
              variant='light'
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              Optimizando Operaciones Desde 2020
            </Badge>

            <Title
              order={1}
              size='3rem'
              fw={700}
              style={{
                lineHeight: 1.2,
                maxWidth: '800px',
                fontSize: 'clamp(2rem, 5vw, 3rem)',
              }}
            >
              Excelencia Centralizada para las Operaciones de tu Negocio
            </Title>

            <Text size='xl' style={{ maxWidth: '600px', lineHeight: 1.6 }}>
              Transforma tu organización con nuestra plataforma integral de servicios compartidos.
              Consolidamos Recursos Humanos, Finanzas, TI y Operaciones en un único centro eficiente
              que impulsa el ahorro de costos y la excelencia operativa.
            </Text>

            <Group gap='md'>
              <Button
                size='lg'
                rightSection={<IconArrowRight size={16} />}
                style={{
                  backgroundColor: 'white',
                  color: '#113562',
                  '&:hover': { backgroundColor: '#f8f9fa' },
                }}
              >
                Solicitar Demo
              </Button>
              <Button size='lg' variant='outline' style={{ borderColor: 'white', color: 'white' }}>
                Saber Más
              </Button>
            </Group>
          </Stack>
        </Container>

        {/* Background Pattern */}
        <Box
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
            backgroundSize: '20px 20px',
            opacity: 0.5,
          }}
        />
      </Box>

      {/* Services Section */}
      <Box py={80} id='services'>
        <Container size='xl'>
          <Stack align='center' gap='lg' mb={60}>
            <Title order={2} size='2.5rem' fw={700} ta='center'>
              Nuestros Servicios
            </Title>
            <Text size='lg' c='dimmed' ta='center' style={{ maxWidth: '600px' }}>
              Una suite completa de servicios empresariales diseñados para optimizar tus operaciones
            </Text>
          </Stack>

          <SimpleGrid cols={{ base: 1, md: 2, lg: 4 }} spacing='lg'>
            {[
              {
                title: 'Recursos Humanos',
                description:
                  'Gestión integral del talento humano, desde reclutamiento hasta desarrollo profesional.',
                icon: '👥',
              },
              {
                title: 'Finanzas y Contabilidad',
                description:
                  'Servicios financieros completos con reporting preciso y cumplimiento normativo.',
                icon: '💰',
              },
              {
                title: 'Servicios de TI',
                description: 'Infraestructura tecnológica robusta y soporte técnico especializado.',
                icon: '💻',
              },
              {
                title: 'Compras',
                description:
                  'Gestión estratégica de adquisiciones y cadena de suministro optimizada.',
                icon: '🛒',
              },
            ].map((service, index) => (
              <Card key={index} shadow='sm' padding='lg' radius='md' withBorder>
                <Text size='3rem' ta='center' py='md'>
                  {service.icon}
                </Text>
                <Title order={3} size='lg' fw={600} mb='sm'>
                  {service.title}
                </Title>
                <Text size='sm' c='dimmed'>
                  {service.description}
                </Text>
              </Card>
            ))}
          </SimpleGrid>
        </Container>
      </Box>

      {/* Benefits Section */}
      <Box py={80} style={{ backgroundColor: '#f8f9fa' }} id='benefits'>
        <Container size='xl'>
          <Grid gutter='xl' align='center'>
            <GridCol span={{ base: 12, md: 6 }}>
              <Title order={2} size='2.5rem' fw={700} mb='lg'>
                Beneficios que Transforman tu Negocio
              </Title>
              <Stack gap='md'>
                {[
                  'Reducción significativa de costos operativos',
                  'Mejora en la calidad y eficiencia de procesos',
                  'Acceso a expertise especializado',
                  'Escalabilidad según las necesidades del negocio',
                  'Cumplimiento normativo garantizado',
                  'Enfoque en el core business de tu empresa',
                ].map((benefit, index) => (
                  <Group key={index} gap='sm' align='flex-start'>
                    <IconCheck
                      size={20}
                      style={{ color: '#10b981', flexShrink: 0, marginTop: 2 }}
                    />
                    <Text size='lg'>{benefit}</Text>
                  </Group>
                ))}
              </Stack>
            </GridCol>
            <GridCol span={{ base: 12, md: 6 }}>
              <Image
                src='/modern-office-workspace-with-collaborative-team-en.jpg'
                alt='Equipo colaborativo en oficina moderna'
                radius='md'
                fit='cover'
                height={400}
              />
            </GridCol>
          </Grid>
        </Container>
      </Box>

      {/* Stats Section */}
      <Box py={80}>
        <Container size='xl'>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing='xl'>
            {[
              { value: '500+', label: 'Empresas Atendidas' },
              { value: '98%', label: 'Satisfacción del Cliente' },
              { value: '35%', label: 'Ahorro Promedio' },
            ].map((stat, index) => (
              <Stack key={index} align='center' gap='xs'>
                <Text size='3rem' fw={700} style={{ color: '#113562' }}>
                  {stat.value}
                </Text>
                <Text size='lg' c='dimmed' ta='center'>
                  {stat.label}
                </Text>
              </Stack>
            ))}
          </SimpleGrid>
        </Container>
      </Box>

      {/* CTA Section */}
      <Box py={80} style={{ backgroundColor: '#113562', color: 'white' }}>
        <Container size='xl'>
          <Stack align='center' gap='lg' style={{ textAlign: 'center' }}>
            <Title order={2} size='2.5rem' fw={700}>
              ¿Listo para Transformar tus Operaciones?
            </Title>
            <Text size='xl' style={{ maxWidth: '600px' }}>
              Únete a cientos de empresas que ya han optimizado sus procesos con nuestros servicios
              compartidos.
            </Text>
            <Group gap='md'>
              <Button
                size='lg'
                component={Link}
                href='/register'
                style={{ backgroundColor: 'white', color: '#113562' }}
              >
                Comenzar Ahora
              </Button>
              <Button size='lg' variant='outline' style={{ borderColor: 'white', color: 'white' }}>
                Contactar Ventas
              </Button>
            </Group>
          </Stack>
        </Container>
      </Box>

      {/* Footer */}
      <Box component='footer' style={{ backgroundColor: '#1f2937', color: 'white' }}>
        <Container size='xl' py='xl'>
          <Grid gutter='xl'>
            <GridCol span={{ base: 12, md: 6, lg: 4 }}>
              <Group align='center' gap='xs' mb='md'>
                <Image
                  src='/Logo_Principal_Blanco_Ancho.svg'
                  alt='ServiciosCompartidos Logo'
                  height={40}
                  width={120}
                  fit='contain'
                />
              </Group>
              <Text size='sm' style={{ lineHeight: 1.6 }}>
                Entregando excelencia operativa a través de servicios empresariales centralizados.
              </Text>
            </GridCol>

            <GridCol span={{ base: 12, md: 6, lg: 2 }}>
              <Title order={4} size='lg' fw={600} mb='md'>
                Servicios
              </Title>
              <Stack gap='xs'>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Recursos Humanos
                </Text>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Finanzas y Contabilidad
                </Text>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Servicios de TI
                </Text>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Compras
                </Text>
              </Stack>
            </GridCol>

            <GridCol span={{ base: 12, md: 6, lg: 2 }}>
              <Title order={4} size='lg' fw={600} mb='md'>
                Empresa
              </Title>
              <Stack gap='xs'>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Nosotros
                </Text>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Carreras
                </Text>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Casos de Éxito
                </Text>
                <Text
                  size='sm'
                  component='a'
                  href='#'
                  style={{ color: '#9ca3af', textDecoration: 'none' }}
                >
                  Blog
                </Text>
              </Stack>
            </GridCol>

            <GridCol span={{ base: 12, md: 6, lg: 4 }}>
              <Title order={4} size='lg' fw={600} mb='md'>
                Contacto
              </Title>
              <Stack gap='sm'>
                <Group gap='xs' align='center'>
                  <IconMail size={16} />
                  <Text size='sm'>contacto@servicioscompartidos.com</Text>
                </Group>
                <Group gap='xs' align='center'>
                  <IconPhone size={16} />
                  <Text size='sm'>+1 (555) 123-4567</Text>
                </Group>
                <Group gap='xs' align='center'>
                  <IconMapPin size={16} />
                  <Text size='sm'>Av. Empresarial 123, Suite 100</Text>
                </Group>
              </Stack>
            </GridCol>
          </Grid>

          <Box mt='xl' pt='lg' style={{ borderTop: '1px solid #374151', textAlign: 'center' }}>
            <Text size='sm' c='dimmed'>
              © {new Date().getFullYear()} ServiciosCompartidos. Todos los derechos reservados.
            </Text>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
