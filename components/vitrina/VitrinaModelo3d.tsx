'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Badge, Box, Button, Center, Group, Image, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconAugmentedReality, IconCube, IconCubeOff } from '@tabler/icons-react';
import type { ModelViewerElement } from '@google/model-viewer';
import { urlImagen, urlModelo3d } from '../../lib/vitrina/medios';

/**
 * Visor del MODELO 3D (GLB) de una presentación, con @google/model-viewer (Apache-2.0, sobre
 * three.js). El Web Component se importa SOLO en el cliente y solo cuando se monta este visor
 * (import dinámico): no pasa por el SSR ni engorda el bundle de las demás páginas.
 *
 *   - girar y acercar con el mouse o con los dedos (camera-controls); touch-action pan-y deja
 *     desplazar la página en vertical sin quedar atrapado en el visor;
 *   - gira solo al cargar y se DETIENE en cuanto la persona lo toca;
 *   - «Ver en mi espacio» (Realidad Aumentada) solo si el navegador la soporta: WebXR (Chrome en
 *     Android con ARCore) o Quick Look (Safari en iPhone/iPad, el USDZ lo genera el visor). No se
 *     usa Scene Viewer: abre la URL fuera del navegador, sin la sesión, y el modelo es privado;
 *   - póster mientras carga: la plegadiza o el vial (si hay);
 *   - fondo con el color de superficie del tema (claro, oscuro y paletas), nunca blanco fijo.
 */
const FONDO = 'var(--app-surface, var(--surface))';

type Estado = 'importando' | 'cargando' | 'listo' | 'fallo';

export default function VitrinaModelo3d({
  id,
  alt,
  poster,
  altura = 'min(70vw, 420px)',
  ar = true,
}: {
  id: number;
  /** Texto alternativo (accesibilidad): «Modelo 3D de Atropina 1 mg x100». */
  alt: string;
  /** Id de la imagen de empaque que se muestra mientras carga (plegadiza o vial), o null. */
  poster: number | null;
  /** Alto del visor (CSS). */
  altura?: string;
  ar?: boolean;
}) {
  const ref = useRef<ModelViewerElement | null>(null);
  const [estado, setEstado] = useState<Estado>('importando');
  const [girando, setGirando] = useState(true);
  const [arDisponible, setArDisponible] = useState(false);

  useEffect(() => {
    let vivo = true;
    import('@google/model-viewer')
      .then(() => {
        if (vivo) setEstado('cargando');
      })
      .catch(() => {
        if (vivo) setEstado('fallo');
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || estado === 'importando' || estado === 'fallo') return;
    const revisarAr = () => setArDisponible(Boolean(ar && el.canActivateAR));
    const onLoad = () => {
      setEstado('listo');
      revisarAr();
    };
    const onError = () => setEstado('fallo');
    const onCamara = (e: Event) => {
      if ((e as CustomEvent<{ source?: string }>).detail?.source === 'user-interaction') setGirando(false);
    };
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    el.addEventListener('camera-change', onCamara);
    // La disponibilidad de WebXR se resuelve en segundo plano: se vuelve a mirar un momento después.
    const t = window.setTimeout(revisarAr, 1500);
    return () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
      el.removeEventListener('camera-change', onCamara);
      window.clearTimeout(t);
    };
  }, [estado, ar]);

  const posterUrl = poster ? urlImagen(poster) : undefined;
  const estilo = { width: '100%', height: altura, backgroundColor: FONDO, '--poster-color': FONDO, display: 'block' } as CSSProperties;

  return (
    <Paper withBorder radius='md' style={{ overflow: 'hidden' }} data-testid='vitrina-modelo3d'>
      <Box pos='relative' bg={FONDO}>
        {estado === 'fallo' ? (
          <Center h={altura}>
            <Stack gap={6} align='center' p='md'>
              {posterUrl ? <Image src={posterUrl} alt={alt} fit='contain' mah={200} /> : <IconCubeOff size={32} color='var(--mantine-color-dimmed)' aria-hidden />}
              <Text size='sm' c='dimmed' ta='center'>
                No se pudo mostrar el modelo 3D en este navegador.
              </Text>
            </Stack>
          </Center>
        ) : estado === 'importando' ? (
          <Center h={altura}>
            {posterUrl ? <Image src={posterUrl} alt={alt} fit='contain' h={altura} w='100%' /> : <Loader />}
          </Center>
        ) : (
          <model-viewer
            ref={ref}
            src={urlModelo3d(id)}
            alt={alt}
            poster={posterUrl}
            loading='lazy'
            reveal='auto'
            camera-controls
            touch-action='pan-y'
            auto-rotate={girando}
            auto-rotate-delay={0}
            rotation-per-second='20deg'
            interaction-prompt='auto'
            shadow-intensity={1}
            ar={ar}
            ar-modes='webxr quick-look'
            ar-placement='floor'
            style={estilo}
          />
        )}
        <Badge pos='absolute' top={8} left={8} variant='light' size='sm' leftSection={<IconCube size={12} />} style={{ pointerEvents: 'none' }}>
          3D
        </Badge>
        {estado === 'cargando' && (
          <Loader size='sm' pos='absolute' top={8} right={8} aria-label='Cargando el modelo 3D' />
        )}
      </Box>
      <Group justify='space-between' wrap='wrap' gap='xs' px='sm' py={6} style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Text size='xs' c='dimmed'>
          Gire con el dedo o el mouse; acerque con dos dedos o la rueda.
        </Text>
        {arDisponible && estado === 'listo' && (
          <Button size='sm' variant='light' leftSection={<IconAugmentedReality size={18} />} onClick={() => void ref.current?.activateAR()} data-testid='vitrina-modelo3d-ar'>
            Ver en mi espacio
          </Button>
        )}
      </Group>
    </Paper>
  );
}
