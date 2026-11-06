'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Alert, Badge, Button, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconPresentation } from '@tabler/icons-react';
import {
  AGRUPACION_LABEL,
  agruparCatalogo,
  facetasCatalogo,
  filtrarCatalogo,
  filtroDeGrupo,
  SUBNIVEL,
  VITRINA_AGRUPACIONES,
  type CatalogoAgrupacion,
  type CatalogoFiltros,
  type CatalogoItem,
  type GrupoCatalogo,
  type OrdenCatalogos,
} from '../../lib/vitrina/catalogo';
import type { CompanyAccess } from './types';
import VitrinaEnConstruccion from './VitrinaEnConstruccion';
import VitrinaFiltros, { useAgrupacionUrl, useFiltrosUrl } from './VitrinaFiltros';
import VitrinaModoPresentacion from './VitrinaModoPresentacion';
import VitrinaTarjeta from './VitrinaTarjeta';
import { catalogoUrl, useVitrinaFetch, type CatalogoResp } from './vitrinaClient';

/** Etiquetas cortas del selector (caben en un celular). */
const AGRUPAR_CORTO: Record<CatalogoAgrupacion, string> = { familia: 'Familia', linea: 'Línea', grupo: 'Grupo', area: 'Servicio' };

/**
 * Biblioteca: presentaciones VALIDADAS con al menos un código activado de la empresa del
 * comercial. Se agrupan por familia, línea comercial, grupo terapéutico o servicio; al agrupar
 * por línea se baja a grupo terapéutico, y por grupo, a servicio (Línea → Grupo → Servicio).
 * Buscador y filtros combinables en la URL. «Presentar» abre el modo presentación con los
 * mismos filtros (o solo con los de una estantería: p. ej. todo lo de UCI); ?presentar=1 lo abre
 * al llegar (accesos del Inicio).
 */
export default function VitrinaBiblioteca({ company }: { company: CompanyAccess }) {
  const { data, error, loading } = useVitrinaFetch<CatalogoResp>(catalogoUrl(company.idCompany));
  const [filtros, setFiltros] = useFiltrosUrl();
  const [agrupar, setAgrupar] = useAgrupacionUrl();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [presentando, setPresentando] = useState<CatalogoFiltros | null>(null);
  const items = useMemo(() => data?.presentaciones ?? [], [data]);
  const orden = data?.orden;
  const facetas = useMemo(() => facetasCatalogo(items, orden), [items, orden]);
  const filtradas = useMemo(() => filtrarCatalogo(items, filtros), [items, filtros]);
  const grupos = useMemo(() => agruparCatalogo(filtradas, agrupar, orden), [filtradas, agrupar, orden]);

  // Accesos del Inicio: ?presentar=1 abre el modo presentación con los filtros de la URL.
  const autoPresentar = params.get('presentar') === '1';
  useEffect(() => {
    if (autoPresentar) setPresentando(filtros);
    // Solo al llegar con el parámetro (los filtros ya vienen en la URL).
  }, [autoPresentar]);
  const cerrar = () => {
    setPresentando(null);
    if (autoPresentar) {
      const qs = new URLSearchParams(params.toString());
      qs.delete('presentar');
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    }
  };

  if (loading && !data) {
    return (
      <Group justify='center' py='xl'>
        <Loader />
      </Group>
    );
  }
  if (error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error}
      </Alert>
    );
  }
  if (items.length === 0) return <VitrinaEnConstruccion company={company} />;

  const presentarGrupo = (por: CatalogoAgrupacion, g: GrupoCatalogo, base: CatalogoFiltros) => {
    const f = g.sinDato ? null : filtroDeGrupo(por, g.clave);
    return f ? () => setPresentando({ ...base, ...f }) : null;
  };

  return (
    <Stack gap='md'>
      <Card withBorder radius='md' p='md'>
        <VitrinaFiltros facetas={facetas} filtros={filtros} onChange={setFiltros} />
      </Card>
      <Stack gap={4}>
        <Text size='sm' fw={500}>
          Agrupar por
        </Text>
        <SegmentedControl
          fullWidth
          size='md'
          value={agrupar}
          onChange={(v) => setAgrupar(v as CatalogoAgrupacion)}
          data={VITRINA_AGRUPACIONES.map((a) => ({ value: a, label: AGRUPAR_CORTO[a] }))}
          aria-label='Agrupar la biblioteca'
          data-testid='vitrina-agrupar'
        />
      </Stack>
      <Group justify='space-between' wrap='wrap' gap='sm'>
        <Text size='sm' c='dimmed' data-testid='vitrina-resultados'>
          {filtradas.length === items.length ? `${items.length} presentaciones` : `${filtradas.length} de ${items.length} presentaciones`}
        </Text>
        <Button size='md' variant='light' leftSection={<IconPresentation size={18} />} onClick={() => setPresentando(filtros)} data-testid='vitrina-abrir-presentacion'>
          Presentar
        </Button>
      </Group>
      {grupos.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>Ninguna presentación coincide con la búsqueda y los filtros.</Text>
        </Card>
      ) : (
        grupos.map((g) => (
          <Estanteria
            key={g.clave}
            grupo={g}
            nivel={1}
            por={agrupar}
            orden={orden}
            idCompany={company.idCompany}
            onPresentar={presentarGrupo(agrupar, g, filtros)}
            presentarSub={(por, sub) => presentarGrupo(por, sub, { ...filtros, ...(g.sinDato ? {} : filtroDeGrupo(agrupar, g.clave)) })}
          />
        ))
      )}
      <VitrinaModoPresentacion company={company} opened={presentando !== null} onClose={cerrar} filtros={presentando ?? filtros} />
    </Stack>
  );
}

function Estanteria({
  grupo,
  nivel,
  por,
  orden,
  idCompany,
  onPresentar,
  presentarSub,
}: {
  grupo: GrupoCatalogo;
  nivel: 1 | 2;
  por: CatalogoAgrupacion;
  orden: OrdenCatalogos | undefined;
  idCompany: number;
  onPresentar: (() => void) | null;
  presentarSub?: (por: CatalogoAgrupacion, g: GrupoCatalogo) => (() => void) | null;
}) {
  const sub = nivel === 1 ? SUBNIVEL[por] : null;
  const subgrupos = useMemo(() => (sub ? agruparCatalogo(grupo.items, sub, orden) : null), [sub, grupo.items, orden]);
  // Si todo cae en «Sin …», no vale la pena el segundo nivel.
  const conSub = subgrupos && subgrupos.some((s) => !s.sinDato) ? subgrupos : null;

  return (
    <Stack gap='sm' pl={nivel === 2 ? { base: 0, sm: 'md' } : 0} data-testid={nivel === 1 ? 'vitrina-familia' : 'vitrina-subgrupo'} data-agrupar={por}>
      <Group justify='space-between' wrap='nowrap' gap='xs'>
        <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
          <Title order={nivel === 1 ? 2 : 3} size={nivel === 1 ? 'h4' : 'h5'} c={grupo.sinDato ? 'dimmed' : undefined} lineClamp={2}>
            {grupo.clave}
          </Title>
          <Badge variant='light' color='gray' size='sm' style={{ flexShrink: 0 }}>
            {grupo.items.length}
          </Badge>
        </Group>
        {onPresentar && (
          <Button size='compact-md' variant='subtle' leftSection={<IconPresentation size={16} />} onClick={onPresentar} aria-label={`Presentar ${AGRUPACION_LABEL[por].toLowerCase()} ${grupo.clave}`} style={{ flexShrink: 0 }}>
            Presentar
          </Button>
        )}
      </Group>
      {conSub && sub ? (
        conSub.map((s) => <Estanteria key={s.clave} grupo={s} nivel={2} por={sub} orden={orden} idCompany={idCompany} onPresentar={presentarSub?.(sub, s) ?? null} />)
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='sm'>
          {grupo.items.map((p: CatalogoItem) => (
            <VitrinaTarjeta key={p.id} item={p} idCompany={idCompany} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
