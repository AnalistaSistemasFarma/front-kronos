'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useFullscreen, useHotkeys } from '@mantine/hooks';
import { IconArrowLeft, IconArrowRight, IconInfoCircle, IconMaximize, IconMinimize, IconX } from '@tabler/icons-react';
import { CANAL_LABEL } from '../../lib/vitrina/constants';
import { filtrarCatalogo, indiceInicial, indiceVecino, registrosDe, tituloPresentacion, type CatalogoFiltros, type CatalogoItem } from '../../lib/vitrina/catalogo';
import type { CompanyAccess } from './types';
import VitrinaImagen from './VitrinaImagen';
import { catalogoUrl, fmtFecha, useVitrinaFetch } from './vitrinaClient';

/**
 * MODO PRESENTACIÓN (frente al cliente). Pantalla completa con UNA presentación a la vez.
 * Los datos llegan del servidor ya depurados (?modo=presentacion): solo «Vista al cliente»
 * u «Ofertable» con registro vigente, por vencer o sin fecha; sin códigos SAP, alertas,
 * exclusividades ni identificadores internos. Anterior / siguiente (también con las
 * flechas del teclado) y «Salir».
 */
export default function VitrinaModoPresentacion({
  company,
  opened,
  onClose,
  filtros,
  idInicial,
}: {
  company: CompanyAccess;
  opened: boolean;
  onClose: () => void;
  filtros?: CatalogoFiltros;
  idInicial?: number | null;
}) {
  const { data, error, loading } = useVitrinaFetch<{ presentaciones: CatalogoItem[] }>(opened ? catalogoUrl(company.idCompany, 'presentacion') : null);
  const lista = useMemo(() => filtrarCatalogo(data?.presentaciones ?? [], filtros ?? {}), [data, filtros]);
  const [i, setI] = useState(0);
  const { toggle, fullscreen } = useFullscreen();

  useEffect(() => {
    if (opened) setI(indiceInicial(lista, idInicial));
  }, [opened, lista, idInicial]);

  const salir = () => {
    if (fullscreen) void toggle();
    onClose();
  };
  const ir = (paso: -1 | 1) => setI((x) => indiceVecino(lista.length, x, paso));
  useHotkeys(
    opened
      ? [
          ['ArrowLeft', () => ir(-1)],
          ['ArrowRight', () => ir(1)],
        ]
      : []
  );

  const p = lista[i] ?? null;

  return (
    <Modal opened={opened} onClose={salir} fullScreen withCloseButton={false} padding={0} radius={0} transitionProps={{ duration: 0 }} data-testid='vitrina-modo-presentacion'>
      <Stack gap={0} mih='100dvh'>
        <Group justify='space-between' wrap='nowrap' px={{ base: 'sm', sm: 'xl' }} py='sm' style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text size='sm' c='dimmed' data-testid='vitrina-presentacion-contador'>
            {lista.length ? `${i + 1} de ${lista.length}` : 'Modo presentación'}
          </Text>
          <Group gap='xs' wrap='nowrap'>
            <Button variant='default' size='md' onClick={() => void toggle()} leftSection={fullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />} visibleFrom='sm'>
              {fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            </Button>
            <Button variant='default' size='md' onClick={salir} leftSection={<IconX size={18} />} data-testid='vitrina-presentacion-salir'>
              Salir
            </Button>
          </Group>
        </Group>

        <div style={{ flex: 1 }}>
          {loading && !data ? (
            <Group justify='center' py='xl'>
              <Loader />
            </Group>
          ) : error ? (
            <Alert color='red' m='md'>
              {error}
            </Alert>
          ) : !p ? (
            <Alert color='blue' variant='light' icon={<IconInfoCircle size={18} />} m='md' data-testid='vitrina-presentacion-vacia'>
              No hay presentaciones para mostrar al cliente{filtros && Object.keys(filtros).length ? ' con estos filtros' : ''}. Aquí solo salen las marcadas como «Vista al cliente» u «Ofertable», con registro sanitario vigente.
            </Alert>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing='xl' p={{ base: 'md', sm: 'xl' }} maw={1400} mx='auto'>
              <SimpleGrid cols={2} spacing='md' style={{ alignSelf: 'start' }}>
                <VitrinaImagen id={p.imagenes.VIAL} etiqueta='Vial' />
                <VitrinaImagen id={p.imagenes.ETIQUETA} etiqueta='Etiqueta' />
              </SimpleGrid>
              <Stack gap='md'>
                <div>
                  {p.familia && (
                    <Text size='sm' c='dimmed' tt='uppercase' fw={600}>
                      {p.familia}
                    </Text>
                  )}
                  <Title order={1} fz={{ base: 28, sm: 40 }} data-testid='vitrina-presentacion-titulo'>
                    {tituloPresentacion(p)}
                  </Title>
                  {p.nombreComercial && (
                    <Text size='xl' mt={4}>
                      {p.nombreComercial}
                    </Text>
                  )}
                </div>
                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='md'>
                  <Dato etiqueta='Forma farmacéutica' valor={p.formaFarmaceutica} />
                  <Dato etiqueta='Concentración' valor={p.concentracion} />
                  <Dato etiqueta='Unidades por caja' valor={p.unidadesCaja ? String(p.unidadesCaja) : null} />
                  <Dato etiqueta='Países' valor={p.paises.join(', ') || null} />
                  {p.canales.length > 0 && <Dato etiqueta='Canal' valor={p.canales.map((c) => CANAL_LABEL[c]).join(', ')} />}
                </SimpleGrid>
                {p.areas.length > 0 && (
                  <div>
                    <Text size='sm' c='dimmed' mb={4}>
                      Áreas asistenciales
                    </Text>
                    <Group gap={6}>
                      {p.areas.map((a) => (
                        <Badge key={a} variant='light' size='lg'>
                          {a}
                        </Badge>
                      ))}
                    </Group>
                  </div>
                )}
                <div>
                  <Text size='sm' c='dimmed' mb={4}>
                    Registro sanitario
                  </Text>
                  {registrosDe(p).map((r) => (
                    <Text key={`${r.numero}-${r.venceEn}`} size='lg'>
                      {r.numero ?? 'Sin número en SAP'}
                      {r.venceEn ? ` · vigente hasta ${fmtFecha(`${r.venceEn}T12:00:00Z`)}` : ''}
                      {r.paises.length ? ` · ${r.paises.join(', ')}` : ''}
                    </Text>
                  ))}
                </div>
              </Stack>
            </SimpleGrid>
          )}
        </div>

        {lista.length > 1 && (
          <Group justify='space-between' px={{ base: 'sm', sm: 'xl' }} py='sm' style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            <Button size='lg' variant='default' leftSection={<IconArrowLeft size={20} />} onClick={() => ir(-1)} disabled={i === 0} data-testid='vitrina-presentacion-anterior'>
              Anterior
            </Button>
            <Button size='lg' rightSection={<IconArrowRight size={20} />} onClick={() => ir(1)} disabled={i >= lista.length - 1} data-autofocus data-testid='vitrina-presentacion-siguiente'>
              Siguiente
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <Text size='sm' c='dimmed'>
        {etiqueta}
      </Text>
      <Text size='lg' fw={500}>
        {valor ?? '—'}
      </Text>
    </div>
  );
}
