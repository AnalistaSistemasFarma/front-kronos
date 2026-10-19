'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import css from './correo.module.css';

/**
 * Fila que se puede DESLIZAR (2026-10-18, como Gmail o el Mail de iOS): con el dedo en el celular y arrastrando
 * con el mouse o el trackpad en el escritorio (Pointer Events: un solo código para iOS Safari, Android Chrome y
 * escritorio).
 *
 * - Solo un gesto MAYORMENTE HORIZONTAL (al menos 1,5 veces más horizontal que vertical, pasados 10 px) mueve la
 *   fila; uno vertical se deja al navegador, que sigue desplazando la lista (`touch-action: pan-y pinch-zoom`).
 * - Detrás aparece el color, el ícono y el texto de la acción; pasado el umbral (35 % del ancho, entre 72 y 160 px,
 *   o un movimiento rápido) el ícono crece y el celular vibra un instante (Android).
 * - Al soltar: si no pasó el umbral, la fila vuelve a su sitio; si pasó, «salir» la lleva fuera de la pantalla y
 *   cierra el espacio (eliminar) y «volver» la devuelve y ejecuta (leído / no leído, o pedir confirmación).
 * - `prefers-reduced-motion`: la fila sigue al dedo, pero sin animaciones de salida ni de regreso.
 * - El clic que el navegador dispara al terminar un arrastre NO abre el hilo.
 */

export interface AccionDeslizar {
  etiqueta: string;
  icono: ReactNode;
  color: 'rojo' | 'azul';
  /** 'salir': la fila sale de la pantalla y se cierra (eliminar). 'volver': regresa a su sitio y luego se ejecuta. */
  salida: 'salir' | 'volver';
  alSoltar: () => void;
}

interface Props {
  /** Deslizar hacia la IZQUIERDA (p. ej. eliminar). */
  izquierda?: AccionDeslizar | null;
  /** Deslizar hacia la DERECHA (p. ej. leído / no leído). */
  derecha?: AccionDeslizar | null;
  reducirMovimiento: boolean;
  children: ReactNode;
}

const DECIDIR_PX = 10;
const DURACION_MS = 180;

export function umbralDeslizar(ancho: number): number {
  return Math.min(160, Math.max(72, ancho * 0.35));
}

interface Gesto {
  id: number;
  x0: number;
  y0: number;
  fase: 'pendiente' | 'horizontal';
  dx: number;
  ultX: number;
  ultT: number;
  vx: number;
  ancho: number;
}

export default function FilaDeslizable({ izquierda, derecha, reducirMovimiento, children }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const frente = useRef<HTMLDivElement>(null);
  const gesto = useRef<Gesto | null>(null);
  const bloquearClic = useRef(false);
  const ladoRef = useRef<'izquierda' | 'derecha' | null>(null);
  const armadoRef = useRef(false);
  const temporizadores = useRef<number[]>([]);
  const [lado, setLado] = useState<'izquierda' | 'derecha' | null>(null);
  const [armado, setArmado] = useState(false);
  const saliendo = useRef(false);
  const habilitado = Boolean(izquierda || derecha);

  useEffect(
    () => () => {
      for (const t of temporizadores.current) window.clearTimeout(t);
    },
    []
  );

  const despues = (ms: number, f: () => void) => {
    temporizadores.current.push(window.setTimeout(f, ms));
  };

  const pintar = (dx: number, animar: boolean) => {
    const el = frente.current;
    if (!el) return;
    el.style.transition = animar && !reducirMovimiento ? `transform ${DURACION_MS}ms ease-out` : 'none';
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
  };

  const marcarLado = (l: 'izquierda' | 'derecha' | null) => {
    if (ladoRef.current === l) return;
    ladoRef.current = l;
    setLado(l);
  };
  const marcarArmado = (a: boolean) => {
    if (armadoRef.current === a) return;
    armadoRef.current = a;
    setArmado(a);
    if (a) {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* sin vibración (iOS, escritorio) */
      }
    }
  };

  const reposo = () => {
    marcarLado(null);
    marcarArmado(false);
    if (raiz.current) delete raiz.current.dataset.deslizando;
  };

  const volver = () => {
    pintar(0, true);
    if (reducirMovimiento) reposo();
    else despues(DURACION_MS, reposo);
  };

  const salir = (sentido: -1 | 1, accion: AccionDeslizar, ancho: number) => {
    saliendo.current = true;
    if (reducirMovimiento) {
      accion.alSoltar();
      return;
    }
    pintar(sentido * ancho * 1.1, true);
    despues(DURACION_MS, () => {
      // Cierra el espacio de la fila antes de quitarla, para que las de abajo suban suavemente.
      const r = raiz.current;
      if (r) {
        r.style.height = `${r.offsetHeight}px`;
        r.style.transition = `height ${DURACION_MS}ms ease-out`;
        void r.offsetHeight;
        r.style.height = '0px';
      }
      despues(DURACION_MS, () => accion.alSoltar());
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    bloquearClic.current = false;
    if (!habilitado || saliendo.current || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, [data-sin-deslizar]')) return;
    gesto.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, fase: 'pendiente', dx: 0, ultX: e.clientX, ultT: e.timeStamp, vx: 0, ancho: raiz.current?.offsetWidth || 360 };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.fase === 'pendiente') {
      if (Math.abs(dx) < DECIDIR_PX && Math.abs(dy) < DECIDIR_PX) return;
      const accion = dx < 0 ? izquierda : derecha;
      // Mayormente vertical o sin acción hacia ese lado: es desplazamiento de la lista, no un gesto de la fila.
      if (Math.abs(dx) < Math.abs(dy) * 1.5 || !accion) {
        gesto.current = null;
        return;
      }
      g.fase = 'horizontal';
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* el puntero ya se soltó */
      }
      window.getSelection?.()?.removeAllRanges();
      if (raiz.current) raiz.current.dataset.deslizando = '1';
    }
    e.preventDefault();
    let x = dx;
    if (x < 0 && !izquierda) x = 0;
    if (x > 0 && !derecha) x = 0;
    x = Math.max(-g.ancho, Math.min(g.ancho, x));
    const dt = e.timeStamp - g.ultT;
    if (dt > 0) g.vx = (e.clientX - g.ultX) / dt;
    g.ultX = e.clientX;
    g.ultT = e.timeStamp;
    g.dx = x;
    pintar(x, false);
    marcarLado(x < 0 ? 'izquierda' : x > 0 ? 'derecha' : null);
    marcarArmado(Math.abs(x) >= umbralDeslizar(g.ancho));
  };

  const soltar = (e: React.PointerEvent<HTMLDivElement>, cancelado: boolean) => {
    const g = gesto.current;
    if (!g || g.id !== e.pointerId) return;
    gesto.current = null;
    if (g.fase !== 'horizontal') return;
    // El clic que sigue a un arrastre no debe abrir el hilo.
    bloquearClic.current = true;
    const accion = g.dx < 0 ? izquierda : g.dx > 0 ? derecha : null;
    const rapido = Math.abs(g.vx) > 0.6 && Math.abs(g.dx) > 40 && Math.sign(g.vx) === Math.sign(g.dx);
    if (cancelado || !accion || !(Math.abs(g.dx) >= umbralDeslizar(g.ancho) || rapido)) {
      volver();
      return;
    }
    if (accion.salida === 'salir') salir(g.dx < 0 ? -1 : 1, accion, g.ancho);
    else {
      volver();
      accion.alSoltar();
    }
  };

  const accion = lado === 'izquierda' ? izquierda : lado === 'derecha' ? derecha : null;

  return (
    <div ref={raiz} className={css.deslizable}>
      {accion && (
        <div className={css.fondoDeslizar} data-lado={lado} data-color={accion.color} data-armado={armado ? '1' : '0'} aria-hidden data-testid='correo-deslizar-fondo'>
          <span className={css.accionDeslizar}>
            {accion.icono}
            <span>{accion.etiqueta}</span>
          </span>
        </div>
      )}
      <div
        ref={frente}
        className={css.frenteDeslizar}
        data-deslizable={habilitado ? '1' : '0'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => soltar(e, false)}
        onPointerCancel={(e) => soltar(e, true)}
        onClickCapture={(e) => {
          if (!bloquearClic.current) return;
          bloquearClic.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
        onDragStart={(e) => habilitado && e.preventDefault()}
      >
        {children}
      </div>
    </div>
  );
}
