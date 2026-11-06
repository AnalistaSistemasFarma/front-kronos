'use client';

import { Alert, Group, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { mensajeSoloDesarrollo } from '../../../lib/proyectos/agentes-desarrollo-rules';
import type { OperadorPases } from '../../../lib/proyectos/permisos-agentes-rules';
import type { RepoCatalogoDto } from '../../../lib/proyectos/permisos-agentes-tipos';
import FormPermisosAgentes, { BadgeNivel, type ValorPermisos } from './FormPermisosAgentes';

/**
 * «Permisos de los agentes» según QUIÉNES son los agentes (2026-10-27, regla de
 * Nicolás Rivera: el código y los repos solo son de los agentes que desarrollan).
 * Con TODOS los agentes de desarrollo, el formulario de nivel y repos; si no, un
 * aviso: el proyecto queda en «Ninguno» y no se ofrecen ni nivel ni repos. La
 * reja real está en el servidor (400).
 */
export default function PermisosSegunAgentes({
  codigoPermitido,
  sinAgentes = false,
  agentesNegocio,
  valor,
  onChange,
  catalogo,
  operadores,
}: {
  codigoPermitido: boolean;
  /** Todavía no hay asistentes escogidos («Nuevo proyecto»). */
  sinAgentes?: boolean;
  /** Nombres de los agentes que no son de desarrollo. */
  agentesNegocio: string[];
  valor: ValorPermisos;
  onChange: (v: ValorPermisos) => void;
  catalogo: RepoCatalogoDto[];
  operadores: OperadorPases[];
}) {
  if (codigoPermitido) return <FormPermisosAgentes valor={valor} onChange={onChange} catalogo={catalogo} operadores={operadores} />;
  return (
    <Alert color='gray' radius='md' icon={<IconInfoCircle size={18} />} py={8} data-testid='permisos-solo-desarrollo'>
      <Group gap={8} wrap='wrap' mb={4}>
        <BadgeNivel nivel='ninguno' />
        <Text size='sm'>Solo conversación e información del proyecto.</Text>
      </Group>
      <Text size='xs' c='dimmed'>
        {sinAgentes
          ? 'Escoja los asistentes. El acceso a código y los repositorios solo se ofrecen cuando todos son agentes de desarrollo.'
          : mensajeSoloDesarrollo(agentesNegocio)}
      </Text>
    </Alert>
  );
}
