/**
 * Tipo JSX del Web Component <model-viewer> (@google/model-viewer, Apache-2.0), que usa la Vitrina
 * Comercial para el modelo 3D (GLB) de cada presentación. El paquete se importa SOLO en el cliente
 * (import dinámico en components/vitrina/VitrinaModelo3d.tsx); aquí solo se declaran los atributos
 * que usamos. La API del elemento (canActivateAR, activateAR…) la tipa el propio paquete.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

interface ModelViewerJsxAttributes extends DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> {
  src?: string;
  alt?: string;
  poster?: string;
  loading?: 'auto' | 'lazy' | 'eager';
  reveal?: 'auto' | 'manual';
  ar?: boolean;
  'ar-modes'?: string;
  'ar-placement'?: 'floor' | 'wall';
  'ar-scale'?: 'auto' | 'fixed';
  'camera-controls'?: boolean;
  'touch-action'?: 'pan-y' | 'pan-x' | 'none';
  'auto-rotate'?: boolean;
  'auto-rotate-delay'?: number | string;
  'rotation-per-second'?: string;
  'interaction-prompt'?: 'auto' | 'none';
  'camera-orbit'?: string;
  'min-camera-orbit'?: string;
  'max-camera-orbit'?: string;
  'shadow-intensity'?: number | string;
  exposure?: number | string;
  'environment-image'?: string;
  'disable-tap'?: boolean;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerJsxAttributes;
    }
  }
}
