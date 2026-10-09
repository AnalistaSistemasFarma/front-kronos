'use client';

import { useMemo, useState } from 'react';
import { Button, Group, Modal, Tooltip } from '@mantine/core';
import { IconBan, IconDownload, IconRefresh } from '@tabler/icons-react';
import { svgToDataUri } from '../../lib/avatar/compose';
import { composeFiguraSvg, figuraAleatoria, type FiguraConfig } from '../../lib/avatar/figuras';
import {
  categoriasFigura,
  conValorFigura,
  etiquetaFigura,
  thumbFiguraDataUri,
  valorFigura,
  type CategoriaFigura,
} from '../../lib/avatar/figuras-editor';
import classes from './avatarEditor.module.css';

/**
 * EDITOR DE FIGURAS para el avatar de un ASISTENTE (animal, planeta,
 * constelación, estrella o robot). Misma interfaz que el editor de Lorelei
 * (AvatarEditor): lienzo al centro, un círculo por opción con su miniatura y
 * la flecha ↕, "Aleatorio" y "Descargar". Todo con <img src="data:…">.
 * No guarda nada: avisa con `onChange` y el padre decide.
 */

const POR_PAGINA = 8;

interface Props {
  config: FiguraConfig;
  onChange: (config: FiguraConfig) => void;
  nombreArchivo?: string;
}

export default function FiguraEditor({ config, onChange, nombreArchivo = 'avatar' }: Props) {
  const [abierto, setAbierto] = useState<CategoriaFigura | null>(null);
  const [pagina, setPagina] = useState(1);
  const [descarga, setDescarga] = useState(false);

  const categorias = useMemo(() => categoriasFigura(config.kind), [config.kind]);
  const vista = useMemo(() => svgToDataUri(composeFiguraSvg(config)), [config]);
  const mitad = Math.ceil(categorias.length / 2);
  const columnas = [categorias.slice(0, mitad), categorias.slice(mitad)];

  const abrir = (cat: CategoriaFigura) => {
    const actual = cat.opciones.indexOf(valorFigura(config, cat.id));
    setPagina(actual >= 0 ? Math.floor(actual / POR_PAGINA) + 1 : 1);
    setAbierto(cat);
  };

  const elegir = (cat: CategoriaFigura, valor: string | null) => {
    onChange(conValorFigura(config, cat.id, valor));
    setAbierto(null);
  };

  const aleatorio = () =>
    onChange(figuraAleatoria(config.kind, { relleno: config.relleno, acento: config.acento, fondo: config.fondo }));

  const descargar = async (formato: 'SVG' | 'PNG') => {
    setDescarga(false);
    let href = '';
    let liberar: (() => void) | null = null;
    if (formato === 'SVG') {
      const url = URL.createObjectURL(new Blob([composeFiguraSvg(config)], { type: 'image/svg+xml' }));
      href = url;
      liberar = () => URL.revokeObjectURL(url);
    } else {
      const img = new Image();
      img.src = vista;
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
            <button type='button' className={classes.circle} onClick={aleatorio} aria-label='Generar una figura aleatoria'>
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
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI generado en el navegador */}
          <img src={vista} alt='Vista previa del avatar' />
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
                      aria-label={`${cat.label}: ${etiquetaFigura(config, cat.id, valorFigura(config, cat.id))}`}
                    >
                      <Miniatura config={config} cat={cat} valor={valorFigura(config, cat.id)} />
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

function Miniatura({
  config,
  cat,
  valor,
  enCuadricula = false,
}: {
  config: FiguraConfig;
  cat: CategoriaFigura;
  valor: string | null;
  enCuadricula?: boolean;
}) {
  const src = useMemo(() => thumbFiguraDataUri(config, cat.id, valor), [config, cat.id, valor]);
  if (cat.esColor) return <Muestra color={valor ?? 'transparent'} />;
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
  cat: CategoriaFigura | null;
  config: FiguraConfig;
  pagina: number;
  onPagina: (p: number) => void;
  onElegir: (cat: CategoriaFigura, valor: string | null) => void;
  onCerrar: () => void;
}) {
  const total = cat?.opciones.length ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const inicio = (pagina - 1) * POR_PAGINA;
  const valores = cat ? cat.opciones.slice(inicio, inicio + POR_PAGINA) : [];
  const actual = cat ? valorFigura(config, cat.id) : undefined;

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
            const etiqueta = etiquetaFigura(config, cat.id, valor);
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
