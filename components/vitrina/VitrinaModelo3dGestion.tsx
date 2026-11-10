'use client';

import { useState } from 'react';
import { Button, Card, FileButton, Group, NumberInput, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCubePlus, IconDeviceFloppy, IconTrash } from '@tabler/icons-react';
import { VITRINA_MODELO3D_ACCEPT, VITRINA_MODELO3D_DIMENSION_MAX_CM, VITRINA_MODELO3D_MAX_BYTES } from '../../lib/vitrina/constants';
import { tamanoLegible } from '../../lib/vitrina/medios';
import type { CompanyAccess } from './types';
import VitrinaModelo3d from './VitrinaModelo3d';
import { errorTexto, fmtFechaHora, vitrinaSend, type Avisar } from './vitrinaClient';

/**
 * Gestión · Imágenes y documentos · «Modelo 3D» (2026-11-04). Un GLB (glTF 2.0 binario) por
 * presentación, en el mismo almacenamiento de adjuntos que las imágenes: cargar, reemplazar (el
 * anterior queda no vigente y en el historial), retirar y vista previa con el mismo visor de la
 * ficha. Medidas del empaque en cm, opcionales (para el comparador futuro).
 */
export interface Modelo3dMedios {
  vigente: {
    id: number;
    version: number;
    nombreOriginal: string;
    tamanoBytes: number;
    cargadoEn: string;
    dimensionesCm: { ancho: number | null; alto: number | null; profundo: number | null };
  } | null;
  anteriores: number;
}

type Medida = number | string;
const aCampo = (n: number | null | undefined): Medida => (n === null || n === undefined ? '' : n);
const aEnvio = (v: Medida): string => (v === '' || v === null || v === undefined ? '' : String(v));

export default function VitrinaModelo3dGestion({
  company,
  idPresentacion,
  titulo,
  poster,
  modelo,
  avisar,
  onCambio,
}: {
  company: CompanyAccess;
  idPresentacion: number;
  titulo: string;
  poster: number | null;
  modelo: Modelo3dMedios;
  avisar: Avisar;
  onCambio: () => Promise<unknown> | void;
}) {
  const v = modelo.vigente;
  const [busy, setBusy] = useState<'subir' | 'medidas' | 'retirar' | null>(null);
  const [ancho, setAncho] = useState<Medida>(aCampo(v?.dimensionesCm.ancho));
  const [alto, setAlto] = useState<Medida>(aCampo(v?.dimensionesCm.alto));
  const [profundo, setProfundo] = useState<Medida>(aCampo(v?.dimensionesCm.profundo));
  const cambiaronMedidas =
    !!v && (aEnvio(ancho) !== aEnvio(aCampo(v.dimensionesCm.ancho)) || aEnvio(alto) !== aEnvio(aCampo(v.dimensionesCm.alto)) || aEnvio(profundo) !== aEnvio(aCampo(v.dimensionesCm.profundo)));

  const correr = async (clave: 'subir' | 'medidas' | 'retirar', fn: () => Promise<unknown>, ok: string) => {
    setBusy(clave);
    try {
      await fn();
      avisar(true, ok);
      await onCambio();
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  const subir = (file: File | null) => {
    if (!file) return;
    if (file.size > VITRINA_MODELO3D_MAX_BYTES) {
      avisar(false, 'El modelo 3D supera el tamaño máximo (25 MB).');
      return;
    }
    const fd = new FormData();
    fd.set('company', String(company.idCompany));
    fd.set('presentacion', String(idPresentacion));
    fd.set('archivo', file);
    fd.set('ancho_cm', aEnvio(ancho));
    fd.set('alto_cm', aEnvio(alto));
    fd.set('profundo_cm', aEnvio(profundo));
    void correr(
      'subir',
      async () => {
        const res = await fetch('/api/vitrina/gestion/modelos-3d', { method: 'POST', body: fd });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error || (res.status === 413 ? 'El modelo supera el tamaño que admite el servidor.' : `Error ${res.status}`));
      },
      v ? 'Modelo 3D reemplazado. El anterior queda en el historial.' : 'Modelo 3D cargado.'
    );
  };

  const medida = (label: string, value: Medida, set: (x: Medida) => void, testid: string) => (
    <NumberInput
      size='md'
      label={label}
      placeholder='Opcional'
      suffix=' cm'
      decimalSeparator=','
      decimalScale={2}
      min={0}
      max={VITRINA_MODELO3D_DIMENSION_MAX_CM}
      allowNegative={false}
      hideControls
      value={value}
      onChange={set}
      data-testid={testid}
    />
  );

  return (
    <Card withBorder radius='md' p='md' data-testid='vitrina-medios-modelo3d'>
      <Text fw={600}>Modelo 3D</Text>
      <Text size='sm' c='dimmed' mb='sm'>
        Archivo GLB (glTF 2.0 binario) de hasta 25 MB, exportado desde Adobe Dimension o Blender. En la ficha del comercial y en el modo presentación se muestra primero, para girarlo y verlo en
        Realidad Aumentada.
      </Text>
      <Stack gap='sm'>
        {v ? (
          <>
            <VitrinaModelo3d key={v.id} id={v.id} alt={`Modelo 3D de ${titulo}`} poster={poster} altura='min(75vw, 320px)' ar={false} />
            <Text size='xs' c='dimmed' data-testid='vitrina-medios-modelo3d-info'>
              Versión {v.version} · {v.nombreOriginal} · {tamanoLegible(v.tamanoBytes)} · {fmtFechaHora(v.cargadoEn)}
              {modelo.anteriores ? ` · ${modelo.anteriores} anterior(es)` : ''}
            </Text>
          </>
        ) : (
          <Text size='sm' c='dimmed'>
            Sin modelo 3D: la ficha muestra las imágenes de empaque.
            {modelo.anteriores ? ` Hay ${modelo.anteriores} modelo(s) anterior(es) en el historial.` : ''}
          </Text>
        )}
        <div>
          <Text size='sm' fw={600}>
            Medidas del empaque (opcional)
          </Text>
          <SimpleGrid cols={3} spacing='xs'>
            {medida('Ancho', ancho, setAncho, 'vitrina-modelo3d-ancho')}
            {medida('Alto', alto, setAlto, 'vitrina-modelo3d-alto')}
            {medida('Profundo', profundo, setProfundo, 'vitrina-modelo3d-profundo')}
          </SimpleGrid>
        </div>
        <Group gap='xs' grow>
          <FileButton accept={VITRINA_MODELO3D_ACCEPT} onChange={subir}>
            {(props) => (
              <Button {...props} size='sm' variant={v ? 'default' : 'filled'} leftSection={<IconCubePlus size={16} />} loading={busy === 'subir'} data-testid='vitrina-modelo3d-cargar'>
                {v ? 'Reemplazar' : 'Cargar modelo'}
              </Button>
            )}
          </FileButton>
          {v && cambiaronMedidas && (
            <Button
              size='sm'
              variant='light'
              leftSection={<IconDeviceFloppy size={16} />}
              loading={busy === 'medidas'}
              onClick={() =>
                correr(
                  'medidas',
                  () => vitrinaSend(`/api/vitrina/gestion/modelos-3d/${v.id}`, 'PATCH', { company: company.idCompany, ancho_cm: aEnvio(ancho), alto_cm: aEnvio(alto), profundo_cm: aEnvio(profundo) }),
                  'Medidas guardadas.'
                )
              }
            >
              Guardar medidas
            </Button>
          )}
          {v && (
            <Button
              size='sm'
              variant='light'
              color='red'
              leftSection={<IconTrash size={16} />}
              loading={busy === 'retirar'}
              onClick={() => correr('retirar', () => vitrinaSend(`/api/vitrina/gestion/modelos-3d/${v.id}?company=${company.idCompany}`, 'DELETE'), 'Modelo 3D retirado.')}
            >
              Retirar
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
