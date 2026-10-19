'use client';

import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ActionIcon, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconDiamondFilled } from '@tabler/icons-react';
import {
  diasEntre,
  ESTADO_VISUAL_COLOR,
  ESTADO_VISUAL_LABELS,
  fechaCortaIso,
  marcasGantt,
  posicionBarra,
  PX_POR_DIA,
  rangoGantt,
  sumarDias,
  type ZoomGantt,
} from '../../../lib/proyectos/cronograma-rules';
import { CONSULTA_ESCRITORIO } from '../ui';
import { coloresDe, type GrupoGantt, type ItemGantt } from './modelo';
import css from './cronograma.module.css';

/**
 * Línea de tiempo (Gantt) del proyecto. Sin librería: CSS + las cuentas puras de
 * lib/proyectos/cronograma-rules.ts (rango, posición de cada barra, marcas).
 *
 * - Barras por tarea y por solicitud (y sus actividades como sub-ítems, plegables), coloreadas
 *   por estado; los hitos son rombos; la línea roja es HOY.
 * - Se desplaza de lado DENTRO de su caja (la columna de nombres queda fija a la izquierda):
 *   la página nunca se desborda, tampoco en el celular.
 * - Cada fila mide 44 px: el nombre y la barra son botones que abren el detalle.
 */
export default function Gantt({
  grupos,
  hoy,
  zoom,
  expandidas,
  onAlternar,
  onAbrir,
}: {
  grupos: GrupoGantt[];
  hoy: string;
  zoom: ZoomGantt;
  expandidas: Set<string>;
  onAlternar: (key: string) => void;
  onAbrir: (item: ItemGantt) => void;
}) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const anchoEtiqueta = escritorio ? 260 : 148;
  const caja = useRef<HTMLDivElement>(null);
  const px = PX_POR_DIA[zoom];

  const todos = useMemo(() => grupos.flatMap((g) => g.items), [grupos]);
  const rango = useMemo(() => rangoGantt(todos.map((i) => ({ inicio: i.inicio, fin: i.objetivo && i.objetivo > i.fin ? i.objetivo : i.fin })), hoy, zoom), [todos, hoy, zoom]);
  const marcas = useMemo(() => marcasGantt(rango.desde, rango.hasta, zoom), [rango, zoom]);
  const ancho = rango.dias * px;
  const xHoy = diasEntre(rango.desde, hoy) * px + px / 2;

  // Al abrir o cambiar el zoom, hoy queda a la vista (a un tercio de la caja).
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, xHoy - (el.clientWidth - anchoEtiqueta) / 3);
  }, [xHoy, anchoEtiqueta, zoom]);

  const finesDeSemana = useMemo(() => {
    if (zoom !== 'semana') return [];
    const out: number[] = [];
    for (let i = 0; i < rango.dias; i++) {
      const dow = new Date(`${sumarDias(rango.desde, i)}T00:00:00Z`).getUTCDay();
      if (dow === 6) out.push(i);
    }
    return out;
  }, [zoom, rango]);

  const visibles = (g: GrupoGantt) => g.items.filter((i) => !i.padre || expandidas.has(i.padre));
  const alto = 48 + grupos.reduce((s, g) => s + 32 + visibles(g).length * 44, 0);
  const anio = Number(hoy.slice(0, 4));

  return (
    <div className={css.gantt} ref={caja} data-testid='cronograma-gantt' role='region' aria-label='Línea de tiempo del proyecto'>
      <div className={css.lienzo} style={{ width: anchoEtiqueta + ancho, minHeight: alto }}>
        {/* Encabezado: meses o trimestres arriba; días, semanas o meses abajo. */}
        <div className={css.fila} style={{ minHeight: 48 }}>
          <div className={css.etiqueta} style={{ width: anchoEtiqueta }}>
            <Text size='xs' fw={600} c='dimmed'>
              Tarea o solicitud
            </Text>
          </div>
          <div className={css.pista} style={{ width: ancho }}>
            <div className={css.cabecera}>
              {marcas.mayores.map((m) => (
                <div key={m.fecha} className={`${css.marca} ${css.marcaMayor}`} style={{ left: m.left, width: m.width }}>
                  {m.etiqueta}
                </div>
              ))}
            </div>
            <div className={css.cabecera} style={{ borderBottom: 0 }}>
              {marcas.menores.map((m) => (
                <div key={m.fecha} className={css.marca} style={{ left: m.left, width: m.width, justifyContent: zoom === 'semana' ? 'center' : undefined, padding: zoom === 'semana' ? 0 : undefined }}>
                  {m.etiqueta}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fondo: rejilla, fines de semana y la línea de hoy. */}
        <div style={{ position: 'absolute', left: anchoEtiqueta, top: 48, bottom: 0, width: ancho, pointerEvents: 'none' }} aria-hidden='true'>
          {finesDeSemana.map((i) => (
            <div key={i} className={css.finDeSemana} style={{ left: i * px, width: 2 * px }} />
          ))}
          {marcas.menores.map((m) => (
            <div key={m.fecha} className={css.rejilla} style={{ left: m.left }} />
          ))}
          {xHoy >= 0 && xHoy <= ancho && <div className={css.hoy} style={{ left: xHoy - 1 }} data-testid='cronograma-hoy' />}
        </div>
        {xHoy >= 0 && xHoy <= ancho && (
          <div className={css.hoyEtiqueta} style={{ left: anchoEtiqueta + xHoy, top: 50 }} aria-hidden='true'>
            Hoy
          </div>
        )}

        {grupos.map((g) => (
          <div key={g.key} role='rowgroup' aria-label={g.titulo}>
            <div className={`${css.fila} ${css.filaGrupo}`}>
              <div className={css.etiqueta} style={{ width: anchoEtiqueta }}>
                <Text size='xs' fw={700} className={css.truncar}>
                  {g.titulo} · {g.items.filter((i) => !i.padre).length}
                </Text>
              </div>
              <div className={css.pista} style={{ width: ancho }} />
            </div>
            {visibles(g).map((i) => (
              <FilaGantt
                key={i.key}
                item={i}
                anchoEtiqueta={anchoEtiqueta}
                ancho={ancho}
                desde={rango.desde}
                hasta={rango.hasta}
                px={px}
                anio={anio}
                expandida={expandidas.has(i.key)}
                onAlternar={() => onAlternar(i.key)}
                onAbrir={() => onAbrir(i)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilaGantt({
  item,
  anchoEtiqueta,
  ancho,
  desde,
  hasta,
  px,
  anio,
  expandida,
  onAlternar,
  onAbrir,
}: {
  item: ItemGantt;
  anchoEtiqueta: number;
  ancho: number;
  desde: string;
  hasta: string;
  px: number;
  anio: number;
  expandida: boolean;
  onAlternar: () => void;
  onAbrir: () => void;
}) {
  const color = ESTADO_VISUAL_COLOR[item.estado];
  const estilo = coloresDe(item.estado, color) as CSSProperties;
  const fuera = item.fin < desde || item.inicio > hasta;
  const pos = posicionBarra(item.inicio, item.fin, desde, px);
  const fechas = item.inicio === item.fin ? fechaCortaIso(item.inicio, anio) : `${fechaCortaIso(item.inicio, anio)} → ${fechaCortaIso(item.fin, anio)}`;
  const descripcion = `${item.hito ? 'Hito' : item.kind === 'tarea' ? 'Tarea' : item.kind === 'solicitud' ? 'Solicitud' : 'Actividad'}: ${item.titulo}. ${fechas}. ${ESTADO_VISUAL_LABELS[item.estado]}${item.progreso !== null ? `, ${item.progreso} %` : ''}.`;
  const sub = item.kind === 'actividad';

  return (
    <div className={css.fila} data-testid={`cronograma-fila-${item.key}`}>
      <div className={css.etiqueta} style={{ width: anchoEtiqueta, paddingLeft: sub ? 26 : 4 }}>
        {item.kind === 'solicitud' && item.hijos > 0 ? (
          <ActionIcon variant='subtle' color='gray' size={36} onClick={onAlternar} aria-label={expandida ? 'Ocultar actividades' : 'Ver actividades'} aria-expanded={expandida} style={{ flexShrink: 0 }}>
            {expandida ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
        ) : null}
        <button type='button' className={css.etiquetaBoton} onClick={onAbrir} aria-label={`Abrir: ${descripcion}`}>
          <Text size={sub ? 'xs' : 'sm'} fw={sub ? 400 : 600} className={css.truncar} lh={1.25}>
            {item.hito && <IconDiamondFilled size={11} style={{ display: 'inline-block', marginRight: 4, verticalAlign: -1, color: `var(--mantine-color-${color}-filled)` }} />}
            {item.titulo}
          </Text>
          {item.subtitulo && (
            <Text size='xs' c='dimmed' className={css.truncar} lh={1.2}>
              {item.subtitulo}
            </Text>
          )}
        </button>
      </div>
      <div className={css.pista} style={{ width: ancho }}>
        {!fuera &&
          (item.hito ? (
            <Tooltip label={descripcion} withArrow openDelay={250} multiline maw={280}>
              <button type='button' className={css.zonaRombo} style={{ ...estilo, left: pos.left + px / 2 }} onClick={onAbrir} aria-label={descripcion} data-testid='cronograma-hito'>
                <span className={css.rombo} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={descripcion} withArrow openDelay={250} multiline maw={280}>
              <button type='button' className={css.zonaBarra} style={{ ...estilo, left: pos.left, width: pos.width }} onClick={onAbrir} aria-label={descripcion} data-testid='cronograma-barra'>
                <span className={`${css.barraItem} ${sub ? css.barraSub : ''} ${item.estado === 'cancelada' ? css.rayada : ''}`}>
                  <span className={css.relleno} style={{ width: item.progreso !== null ? `${item.progreso}%` : item.estado === 'hecha' || sub ? '100%' : '0%' }} />
                  {!sub && pos.width >= 70 && (
                    <span className={css.barraTexto}>
                      {item.progreso !== null ? `${item.progreso} % · ` : ''}
                      {item.titulo}
                    </span>
                  )}
                </span>
              </button>
            </Tooltip>
          ))}
        {item.objetivo && item.objetivo >= desde && item.objetivo <= hasta && (
          <Tooltip label={`Fecha objetivo: ${fechaCortaIso(item.objetivo, anio)}`} withArrow>
            <span
              aria-hidden='true'
              style={{
                position: 'absolute',
                top: '50%',
                left: diasEntre(desde, item.objetivo) * px + px / 2,
                width: 12,
                height: 12,
                transform: 'translate(-50%, -50%) rotate(45deg)',
                border: `2px solid var(--mantine-color-${color}-filled)`,
                background: 'var(--mantine-color-body)',
                zIndex: 2,
              }}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
