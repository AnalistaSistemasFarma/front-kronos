'use client';

import { useMemo, useState } from 'react';
import { Button, Group, Modal, Tooltip } from '@mantine/core';
import { IconBan, IconDownload, IconFlipVertical, IconRefresh } from '@tabler/icons-react';
import {
  CATEGORIAS_EDITOR,
  composeAvatarSvg,
  composePartThumbSvg,
  etiquetaOpcion,
  randomAvatarConfig,
  svgToDataUri,
  type CategoriaEditor,
} from '../../lib/avatar/compose';
import type { AvatarConfig } from '../../lib/avatar/types';
import classes from './avatarEditor.module.css';

/**
 * EDITOR DE AVATAR ESTILO NOTION con DiceBear + Lorelei. Misma interfaz que
 * Avatartion (github.com/wilmerterrero/Avatartion, MIT; solo la idea, ningún
 * dibujo):
 *
 *   - lienzo al centro con el avatar y su fondo;
 *   - a un lado, un círculo por opción de Lorelei (cabello, cara, ojos, cejas,
 *     boca, nariz, lentes, barba, aretes, pecas, accesorio y colores) con su
 *     miniatura y la flecha ↕; al tocarlo se abre la cuadrícula de opciones
 *     (8 por página) y al elegir una se cierra sola;
 *   - al otro lado, "Aleatorio", "Voltear" y "Descargar" (SVG o PNG).
 *
 * La vista previa usa createAvatar(lorelei, …) en el navegador con el MISMO
 * código (lib/avatar/compose.ts) que usa el servidor para servir la imagen.
 * Este componente NO guarda nada: avisa con `onChange` y el padre decide.
 */

const POR_PAGINA = 8;

interface Props {
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
  /** Nombre base del archivo descargado. */
  nombreArchivo?: string;
}

export default function AvatarEditor({ config, onChange, nombreArchivo = 'avatar' }: Props) {
  const [abierto, setAbierto] = useState<CategoriaEditor | null>(null);
  const [pagina, setPagina] = useState(1);
  const [descarga, setDescarga] = useState(false);

  const svg = useMemo(() => composeAvatarSvg(config), [config]);

  const mitad = Math.ceil(CATEGORIAS_EDITOR.length / 2);
  const columnas = [CATEGORIAS_EDITOR.slice(0, mitad), CATEGORIAS_EDITOR.slice(mitad)];

  const abrir = (cat: CategoriaEditor) => {
    const actual = cat.opciones.indexOf(config[cat.id] ?? null);
    setPagina(actual >= 0 ? Math.floor(actual / POR_PAGINA) + 1 : 1);
    setAbierto(cat);
  };

  const elegir = (cat: CategoriaEditor, valor: string | null) => {
    onChange({ ...config, [cat.id]: valor } as AvatarConfig);
    setAbierto(null);
  };

  // Aleatorio: partes nuevas (azar de DiceBear) conservando los colores elegidos.
  const aleatorio = () =>
    onChange(
      randomAvatarConfig({
        hairColor: config.hairColor,
        skinColor: config.skinColor,
        backgroundColor: config.backgroundColor,
      })
    );

  const voltear = () => onChange({ ...config, flip: !config.flip });

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

  return (
    <div className={classes.editor}>
      <div className={classes.stage}>
        <div className={classes.actions}>
          <Tooltip label='Aleatorio' color='dark' withArrow>
            <button type='button' className={classes.circle} onClick={aleatorio} aria-label='Generar un avatar aleatorio'>
              <IconRefresh size={24} stroke={2} />
            </button>
          </Tooltip>
          <Tooltip label='Voltear' color='dark' withArrow>
            <button
              type='button'
              className={classes.circle}
              onClick={voltear}
              aria-pressed={config.flip}
              aria-label='Voltear el avatar horizontalmente'
            >
              <IconFlipVertical size={24} stroke={2} />
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
              {col.map((cat) => (
                <div key={cat.id} className={classes.pickerRow}>
                  <Tooltip label={cat.label} color='dark' withArrow>
                    <button
                      type='button'
                      className={classes.circle}
                      onClick={() => abrir(cat)}
                      aria-label={`${cat.label}: ${etiquetaOpcion(cat.id, config[cat.id] ?? null)}`}
                    >
                      <Miniatura config={config} cat={cat} valor={config[cat.id] ?? null} />
                    </button>
                  </Tooltip>
                  <Flecha onClick={() => abrir(cat)} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <SelectorModal
        cat={abierto}
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

function Miniatura({ config, cat, valor, enCuadricula = false }: { config: AvatarConfig; cat: CategoriaEditor; valor: string | null; enCuadricula?: boolean }) {
  const src = useMemo(() => svgToDataUri(composePartThumbSvg(config, cat.id, valor)), [config, cat.id, valor]);
  if (cat.esColor) return <Muestra color={valor ?? 'transparent'} />;
  // "Ninguno" en el círculo: se marca con el símbolo de vacío.
  if (valor === null && !enCuadricula) return <IconBan size={22} stroke={1.5} color='#9ca3af' aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- data: URI generado en el navegador
  return <img src={src} alt='' />;
}

function Muestra({ color }: { color: string }) {
  return (
    <span
      className={classes.swatch}
      style={
        color !== 'transparent'
          ? { background: `#${color}` }
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
  cat,
  config,
  pagina,
  onPagina,
  onElegir,
  onCerrar,
}: {
  cat: CategoriaEditor | null;
  config: AvatarConfig;
  pagina: number;
  onPagina: (p: number) => void;
  onElegir: (cat: CategoriaEditor, valor: string | null) => void;
  onCerrar: () => void;
}) {
  const total = cat?.opciones.length ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const inicio = (pagina - 1) * POR_PAGINA;
  const valores = cat ? cat.opciones.slice(inicio, inicio + POR_PAGINA) : [];
  const actual = cat ? config[cat.id] ?? null : undefined;

  return (
    <Modal
      opened={!!cat}
      onClose={onCerrar}
      title={cat?.title}
      centered
      radius='lg'
      size='md'
      styles={{ title: { fontWeight: 600, width: '100%', textAlign: 'center' } }}
    >
      <p className={classes.modalHint}>Haga clic en una opción para seleccionarla y cerrar esta ventana</p>
      <p className={classes.modalCount}>
        {cat?.esColor ? 'Colores disponibles' : 'Opciones disponibles'}: {total}
      </p>
      <div className={classes.grid}>
        {cat &&
          valores.map((valor) => {
            const etiqueta = etiquetaOpcion(cat.id, valor);
            return (
              <button
                key={valor ?? 'ninguno'}
                type='button'
                className={classes.option}
                aria-pressed={actual === valor}
                aria-label={etiqueta}
                title={etiqueta}
                onClick={() => onElegir(cat, valor)}
              >
                <Miniatura config={config} cat={cat} valor={valor} enCuadricula />
                <span className={classes.optionLabel}>{etiqueta}</span>
              </button>
            );
          })}
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
export function configInicial(): AvatarConfig {
  return randomAvatarConfig();
}
