'use client';

import { Box, Skeleton } from '@mantine/core';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

interface ChartContainerProps {
  /** Altura fija del área del gráfico */
  height: number;
  /** Ancho mínimo del contenedor; use 0 en columnas flex/grid estrechas */
  minWidth?: number;
  children: ReactNode;
}

function injectChartDimensions(
  child: ReactNode,
  width: number,
  height: number
): ReactNode {
  if (!isValidElement(child)) return child;

  const props = child.props as Record<string, unknown>;
  const nextProps: Record<string, unknown> = {
    w: width,
    h: height,
    width,
    height,
  };

  if (props.style && typeof props.style === 'object') {
    nextProps.style = { ...props.style, minWidth: 0 };
  } else {
    nextProps.style = { minWidth: 0 };
  }

  return cloneElement(child as ReactElement<Record<string, unknown>>, nextProps);
}

/**
 * Monta Mantine/Recharts solo cuando el contenedor tiene tamaño medible
 * y pasa width/height en píxeles (evita width(0) height(0) y width(-1)).
 */
export function ChartContainer({ height, minWidth = 0, children }: ChartContainerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let rafId = 0;

    const measure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const measuredHeight = Math.floor(rect.height) || height;

        if (width > 0 && measuredHeight > 0) {
          setDims((prev) =>
            prev?.width === width && prev?.height === measuredHeight
              ? prev
              : { width, height: measuredHeight }
          );
        } else {
          setDims(null);
        }
      });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [height, minWidth]);

  const chartChild = dims ? injectChartDimensions(Children.only(children), dims.width, dims.height) : null;

  return (
    <Box
      ref={ref}
      w='100%'
      style={{
        height,
        minHeight: height,
        minWidth: minWidth > 0 ? minWidth : 0,
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {chartChild ?? <Skeleton height={height} radius='md' />}
    </Box>
  );
}
