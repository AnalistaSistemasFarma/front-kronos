'use client';

import { useMemo, useState } from 'react';
import { Button, Group, Modal, SegmentedControl, Tooltip } from '@mantine/core';
import { IconBan, IconDownload, IconRefresh } from '@tabler/icons-react';
import {
  AVATAR_BACKGROUNDS,
  FONDO_INICIAL,
  categoriasDe,
  composeAvatarSvg,
  esTipoAvatar,
  etiquetaTipo,
  composePartThumbSvg,
  randomAvatarConfig,
  svgToDataUri,
} from '../../lib/avatar/compose';
import type { AvatarCategory, AvatarConfig, AvatarKind } from '../../lib/avatar/types';
import classes from './avatarEditor.module.css';

/**
 * EDITOR DE AVATAR ESTILO NOTION — mismo aspecto y comportamiento que
 * Avatartion (github.com/wilmerterrero/Avatartion, licencia MIT):
 *
 *   - lienzo al centro con el avatar y su color de fondo;
 *   - a un lado, un círculo por parte con su miniatura y la flecha ↕; al
 *     tocarlo se abre una ventana con la cuadrícula de opciones (8 por
 *     página, paginación en píldoras) y al elegir una se cierra sola;
 *   - al otro lado, "Aleatorio" y "Descargar" (SVG o PNG).
 *
 * Los dibujos: personas con las piezas de "Noto avatar" (CC0, las mismas de
 * notion-avatar); animales, planetas y constelaciones propios de SynerLink.
 * Nada de Avatartion: sus ilustraciones son de DrawKit y su licencia no
 * permite incluirlas en un creador de avatares. Ver docs/avatar-notion.md.
 *
 * Este componente NO guarda nada: avisa con `onChange` y el padre decide.
 */

const POR_PAGINA = 8;
const FONDO_ID = '__fondo';

interface Props {
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
  /** Tipos que se pueden elegir (agentes: animal, planeta, constelación y persona). */
  tiposPermitidos?: AvatarKind[];
  /** Nombre base del archivo descargado. */
  nombreArchivo?: string;
}

type Selector = { cat: AvatarCategory } | { fondo: true };

export default function AvatarEditor({ config, onChange, tiposPermitidos = ['persona'], nombreArchivo = 'avatar' }: Props) {
  const [abierto, setAbierto] = useState<Selector | null>(null);
  const [pagina, setPagina] = useState(1);
  const [descarga, setDescarga] = useState(false);

  const categorias = categoriasDe(config.tipo);
  const svg = useMemo(() => composeAvatarSvg(config), [config]);

  // Igual que Avatartion: dos columnas de partes; la segunda termina con el fondo.
  const mitad = Math.ceil((categorias.length + 1) / 2);
  const columnas: Array<Array<AvatarCategory | 'fondo'>> = [
    categorias.slice(0, mitad),
    [...categorias.slice(mitad), 'fondo'],
  ];

  const abrir = (s: Selector) => {
    setPagina(1);
    setAbierto(s);
  };

  const elegir = (catId: string, indice: number) => {
    if (catId === FONDO_ID) onChange({ ...config, fondo: indice });
    else onChange({ ...config, partes: { ...config.partes, [catId]: indice } });
    setAbierto(null);
  };

  const aleatorio = () => onChange(randomAvatarConfig(config.tipo));

  const cambiarTipo = (tipo: string) => {
    if (!esTipoAvatar(tipo) || tipo === config.tipo) return;
    onChange(randomAvatarConfig(tipo, { fondo: config.fondo }));
  };

  const descargar = async (formato: 'SVG' | 'PNG') => {
    setDescarga(false);
    let href = '';
    let liberar: (() => void) | null = null;
    if (formato === 'SVG') {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      href = url;
      liberar = () => URL.revokeObjectURL(url);
    } else {
      // PNG sin dependencias: se pinta el SVG en un canvas de 600×600.
      const img = new Image();
      img.src = svgToDataUri(svg);
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 600;
      canvas.getContext('2d')?.drawImage(img, 0, 0, 600, 600);
      href = canvas.toDataURL('image/png');
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = `${nombreArchivo}.${formato.toLowerCase()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    liberar?.();
  };

  const fondoActual = AVATAR_BACKGROUNDS[config.fondo];

  return (
    <div className={classes.editor}>
      {tiposPermitidos.length > 1 && (
        <SegmentedControl
          value={config.tipo}
          onChange={cambiarTipo}
          fullWidth
          aria-label='Tipo de avatar'
          data={tiposPermitidos.map((t) => ({ value: t, label: etiquetaTipo(t) }))}
        />
      )}

      <div className={classes.stage}>
        <div className={classes.actions}>
          <Tooltip label='Aleatorio' color='dark' withArrow>
            <button type='button' className={classes.circle} onClick={aleatorio} aria-label='Generar un avatar aleatorio'>
              <IconRefresh size={24} stroke={2} />
            </button>
          </Tooltip>
          <Tooltip label='Descargar' color='dark' withArrow>
            <button type='button' className={classes.circle} onClick={() => setDescarga(true)} aria-label='Descargar el avatar'>
              <IconDownload size={24} stroke={2} />
            </button>
          </Tooltip>
        </div>

        <div className={classes.canvas} data-testid='avatar-canvas'>
          {/* data: URI en un <img>: el SVG no se inyecta en el DOM (next/image no aplica a data:). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={svgToDataUri(svg)} alt='Vista previa del avatar' />
        </div>

        <div className={classes.pickerColumns}>
          {columnas.map((col, i) => (
            <div key={i} className={classes.pickerColumn}>
              {col.map((item) =>
                item === 'fondo' ? (
                  <div key='fondo' className={classes.pickerRow}>
                    <Tooltip label='Fondo' color='dark' withArrow>
                      <button
                        type='button'
                        className={classes.circle}
                        onClick={() => abrir({ fondo: true })}
                        aria-label={`Fondo: ${fondoActual?.label ?? ''}`}
                      >
                        <Muestra color={fondoActual?.color ?? null} />
                      </button>
                    </Tooltip>
                    <Flecha onClick={() => abrir({ fondo: true })} />
                  </div>
                ) : (
                  <div key={item.id} className={classes.pickerRow}>
                    <Tooltip label={item.label} color='dark' withArrow>
                      <button
                        type='button'
                        className={classes.circle}
                        onClick={() => abrir({ cat: item })}
                        aria-label={`${item.label}: ${item.options[config.partes[item.id] ?? 0]?.label ?? ''}`}
                      >
                        <Miniatura tipo={config.tipo} catId={item.id} indice={config.partes[item.id] ?? 0} />
                      </button>
                    </Tooltip>
                    <Flecha onClick={() => abrir({ cat: item })} />
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      <SelectorModal
        abierto={abierto}
        tipo={config.tipo}
        config={config}
        pagina={pagina}
        onPagina={setPagina}
        onElegir={elegir}
        onCerrar={() => setAbierto(null)}
      />

      <Modal opened={descarga} onClose={() => setDescarga(false)} title='Descargar avatar' centered radius='lg'>
        <Group justify='center' gap='md'>
          <Button variant='default' onClick={() => void descargar('SVG')}>
            SVG
          </Button>
          <Button variant='default' onClick={() => void descargar('PNG')}>
            PNG
          </Button>
        </Group>
      </Modal>
    </div>
  );
}

function Miniatura({ tipo, catId, indice }: { tipo: AvatarKind; catId: string; indice: number }) {
  const src = useMemo(() => svgToDataUri(composePartThumbSvg(tipo, catId, indice)), [tipo, catId, indice]);
  const opcion = categoriasDe(tipo).find((c) => c.id === catId)?.options[indice];
  // "Ninguno": un círculo vacío no dice nada; se marca con el símbolo de vacío.
  if (opcion && !opcion.svg) return <IconBan size={22} stroke={1.5} color='#9ca3af' aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- data: URI generado en el navegador
  return <img src={src} alt='' />;
}

function Muestra({ color }: { color: string | null }) {
  return (
    <span
      className={classes.swatch}
      style={
        color
          ? { background: color }
          : {
              backgroundImage:
                'linear-gradient(45deg,#d1d5db 25%,transparent 25%),linear-gradient(-45deg,#d1d5db 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d1d5db 75%),linear-gradient(-45deg,transparent 75%,#d1d5db 75%)',
              backgroundSize: '10px 10px',
              backgroundPosition: '0 0,0 5px,5px -5px,-5px 0',
            }
      }
    />
  );
}

/** La flecha ↕ de Avatartion (abre el mismo selector que el círculo). */
function Flecha({ onClick }: { onClick: () => void }) {
  return (
    <button type='button' className={classes.selector} onClick={onClick} aria-hidden='true' tabIndex={-1}>
      <svg width='24' height='24' viewBox='0 0 24 24' fill='none'>
        <path d='M7 15L12 20L17 15M7 9L12 4L17 9' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      </svg>
    </button>
  );
}

function SelectorModal({
  abierto,
  tipo,
  config,
  pagina,
  onPagina,
  onElegir,
  onCerrar,
}: {
  abierto: Selector | null;
  tipo: AvatarKind;
  config: AvatarConfig;
  pagina: number;
  onPagina: (p: number) => void;
  onElegir: (catId: string, indice: number) => void;
  onCerrar: () => void;
}) {
  const esFondo = !!abierto && 'fondo' in abierto;
  const cat = abierto && 'cat' in abierto ? abierto.cat : null;
  const total = esFondo ? AVATAR_BACKGROUNDS.length : cat?.options.length ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const inicio = (pagina - 1) * POR_PAGINA;
  const indices = Array.from({ length: Math.min(POR_PAGINA, total - inicio) }, (_, i) => inicio + i);
  const actual = esFondo ? config.fondo : cat ? config.partes[cat.id] ?? 0 : -1;

  return (
    <Modal
      opened={!!abierto}
      onClose={onCerrar}
      title={esFondo ? 'Fondos' : cat?.title}
      centered
      radius='lg'
      size='md'
      styles={{ title: { fontWeight: 600, width: '100%', textAlign: 'center' } }}
    >
      <p className={classes.modalHint}>Haga clic en una opción para seleccionarla y cerrar esta ventana</p>
      <p className={classes.modalCount}>
        {esFondo ? 'Colores disponibles' : 'Opciones disponibles'}: {total}
      </p>
      <div className={classes.grid}>
        {indices.map((i) =>
          esFondo ? (
            <button
              key={i}
              type='button'
              className={classes.option}
              aria-pressed={actual === i}
              aria-label={AVATAR_BACKGROUNDS[i].label}
              onClick={() => onElegir(FONDO_ID, i)}
            >
              <Muestra color={AVATAR_BACKGROUNDS[i].color} />
            </button>
          ) : cat ? (
            <button
              key={i}
              type='button'
              className={classes.option}
              aria-pressed={actual === i}
              aria-label={cat.options[i].label}
              title={cat.options[i].label}
              onClick={() => onElegir(cat.id, i)}
            >
              <Miniatura tipo={tipo} catId={cat.id} indice={i} />
              <span className={classes.optionLabel}>{cat.options[i].label}</span>
            </button>
          ) : null
        )}
      </div>
      {paginas > 1 && (
        <nav aria-label='Páginas de opciones'>
          <ul className={classes.pages}>
            {Array.from({ length: paginas }, (_, i) => i + 1).map((p) => (
              <li key={p}>
                <button
                  type='button'
                  className={classes.page}
                  aria-current={p === pagina ? 'page' : undefined}
                  onClick={() => onPagina(p)}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </Modal>
  );
}

/** Configuración con la que arranca el editor cuando no hay nada guardado. */
export function configInicial(tipo: AvatarKind): AvatarConfig {
  return randomAvatarConfig(tipo, { fondo: FONDO_INICIAL });
}
