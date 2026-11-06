'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button, Collapse, Group, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAdjustmentsHorizontal, IconSearch, IconX } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { CANAL_LABEL } from '../../lib/vitrina/constants';
import { agrupacionDesdeParams, FILTROS_CLAVES, filtrosDesdeParams, type CatalogoAgrupacion, type CatalogoFacetas, type CatalogoFiltros } from '../../lib/vitrina/catalogo';

/**
 * Filtros de la Vitrina guardados en la URL (?q=&pais=&canal=&area=&forma=&linea=&grupo=): se pueden
 * compartir y «Presencia LATAM» abre la Biblioteca ya filtrada por país. La empresa
 * (?empresa=) se conserva.
 */
export function useFiltrosUrl(): [CatalogoFiltros, (f: CatalogoFiltros) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filtros = useMemo(() => filtrosDesdeParams(params), [params]);
  const setFiltros = useCallback(
    (f: CatalogoFiltros) => {
      const qs = new URLSearchParams(params.toString());
      for (const k of FILTROS_CLAVES) {
        const v = f[k]?.trim();
        if (v) qs.set(k, v);
        else qs.delete(k);
      }
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );
  return [filtros, setFiltros];
}

/** Agrupación de la Biblioteca en la URL (?agrupar=linea|grupo|area; familia por defecto). */
export function useAgrupacionUrl(): [CatalogoAgrupacion, (a: CatalogoAgrupacion) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const agrupar = useMemo(() => agrupacionDesdeParams(params), [params]);
  const setAgrupar = useCallback(
    (a: CatalogoAgrupacion) => {
      const qs = new URLSearchParams(params.toString());
      if (a === 'familia') qs.delete('agrupar');
      else qs.set('agrupar', a);
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );
  return [agrupar, setAgrupar];
}

/** Buscador + filtros combinables (línea comercial, grupo terapéutico, servicio, forma, país y canal). */
export default function VitrinaFiltros({ facetas, filtros, onChange }: { facetas: CatalogoFacetas; filtros: CatalogoFiltros; onChange: (f: CatalogoFiltros) => void }) {
  const escritorio = useMediaQuery('(min-width: 62em)') ?? false;
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState(filtros.q ?? '');
  const activos = (['linea', 'grupo', 'area', 'pais', 'canal', 'forma'] as const).filter((k) => filtros[k]).length;
  const set = (k: keyof CatalogoFiltros, v: string | null) => onChange({ ...filtros, [k]: v ?? undefined });

  return (
    <Stack gap='sm'>
      <Group gap='sm' wrap='nowrap' align='flex-end'>
        <TextInput
          size='md'
          style={{ flex: 1, minWidth: 0 }}
          placeholder='Buscar molécula, marca, línea, grupo o código'
          aria-label='Buscar en la Vitrina'
          leftSection={<IconSearch size={18} />}
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            set('q', e.currentTarget.value);
          }}
          data-testid='vitrina-buscar'
        />
        {!escritorio && (
          <Button
            size='md'
            variant={activos ? 'light' : 'default'}
            onClick={() => setAbierto((o) => !o)}
            leftSection={<IconAdjustmentsHorizontal size={18} />}
            rightSection={activos ? <Badge size='sm' circle>{activos}</Badge> : null}
            aria-expanded={abierto}
            data-testid='vitrina-filtros-boton'
          >
            Filtros
          </Button>
        )}
      </Group>
      <Collapse in={escritorio || abierto}>
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing='sm'>
          {facetas.lineas.length > 0 && (
            <SgcSelect size='md' label='Línea comercial' placeholder='Todas' data={facetas.lineas} value={filtros.linea ?? null} onChange={(v) => set('linea', v)} clearable searchable data-testid='vitrina-filtro-linea' />
          )}
          {facetas.grupos.length > 0 && (
            <SgcSelect size='md' label='Grupo terapéutico' placeholder='Todos' data={facetas.grupos} value={filtros.grupo ?? null} onChange={(v) => set('grupo', v)} clearable searchable data-testid='vitrina-filtro-grupo' />
          )}
          <SgcSelect size='md' label='Servicio' placeholder='Todos' data={facetas.areas} value={filtros.area ?? null} onChange={(v) => set('area', v)} clearable searchable data-testid='vitrina-filtro-area' />
          <SgcSelect size='md' label='País' placeholder='Todos' data={facetas.paises} value={filtros.pais ?? null} onChange={(v) => set('pais', v)} clearable searchable data-testid='vitrina-filtro-pais' />
          <SgcSelect
            size='md'
            label='Canal'
            placeholder='Todos'
            data={facetas.canales.map((c) => ({ value: c, label: CANAL_LABEL[c] }))}
            value={filtros.canal ?? null}
            onChange={(v) => set('canal', v)}
            clearable
            data-testid='vitrina-filtro-canal'
          />
          <SgcSelect size='md' label='Forma farmacéutica' placeholder='Todas' data={facetas.formas} value={filtros.forma ?? null} onChange={(v) => set('forma', v)} clearable data-testid='vitrina-filtro-forma' />
        </SimpleGrid>
      </Collapse>
      {(activos > 0 || filtros.q) && (
        <Group gap='xs'>
          <Button
            size='compact-md'
            variant='subtle'
            leftSection={<IconX size={16} />}
            onClick={() => {
              setQ('');
              onChange({});
            }}
            data-testid='vitrina-limpiar'
          >
            Limpiar filtros
          </Button>
        </Group>
      )}
    </Stack>
  );
}
