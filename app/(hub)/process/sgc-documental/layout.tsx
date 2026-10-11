'use client';

import { useEffect, type ReactNode } from 'react';
import '../../../../components/sgc/sgc-movil.css';

/**
 * Marco del módulo Documentos (SGC). Solo activa los ajustes para celular
 * (components/sgc/sgc-movil.css) mientras se navega dentro del SGC: marca el
 * <body> con `sgc-movil` para que también alcancen a los modales, que Mantine
 * monta fuera del contenido. Todas las reglas están bajo
 * `@media (max-width: 48em)`: en escritorio nada cambia. No toca el resto de
 * SynerLink (al salir del módulo se quita la marca).
 */
export default function SgcDocumentalLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('sgc-movil');
    return () => document.body.classList.remove('sgc-movil');
  }, []);
  return children;
}
