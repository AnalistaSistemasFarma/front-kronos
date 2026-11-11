'use client';

import { Alert, Stack } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { avisoSinCodigo, pideCodigo } from '../../../lib/proyectos/agentes-desarrollo-rules';
import type { OperadorPases } from '../../../lib/proyectos/permisos-agentes-rules';
import type { RepoCatalogoDto } from '../../../lib/proyectos/permisos-agentes-tipos';
import FormPermisosAgentes, { type ValorPermisos } from './FormPermisosAgentes';

/**
 * «Permisos de los agentes» con agentes de desarrollo y de negocio (2026-11-11,
 * Nicolás Rivera: «la mesa de discusión no debe depender de proyectos de
 * desarrollo»). El formulario de nivel y repos se ofrece siempre; si hay agentes
 * de NEGOCIO y la política da código, un aviso informativo (no bloquea): ellos
 * participan sin acceso al código. La reja real está en el servidor: el puente
 * les entrega «ninguno» y sin repos.
 */
export default function PermisosSegunAgentes({
  agentesNegocio,
  valor,
  onChange,
  catalogo,
  operadores,
}: {
  /** Nombres de los agentes que no son de desarrollo. */
  agentesNegocio: string[];
  valor: ValorPermisos;
  onChange: (v: ValorPermisos) => void;
  catalogo: RepoCatalogoDto[];
  operadores: OperadorPases[];
}) {
  const aviso = pideCodigo(valor) ? avisoSinCodigo(agentesNegocio) : '';
  return (
    <Stack gap='sm'>
      <FormPermisosAgentes valor={valor} onChange={onChange} catalogo={catalogo} operadores={operadores} />
      {aviso && (
        <Alert color='blue' variant='light' radius='md' icon={<IconInfoCircle size={18} />} py={8} data-testid='permisos-negocio-sin-codigo'>
          {aviso}
        </Alert>
      )}
    </Stack>
  );
}
