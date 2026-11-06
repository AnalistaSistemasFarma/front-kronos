'use client';

import { Alert, Badge, Checkbox, Group, Radio, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconBrandGithub, IconCode, IconEye, IconGitPullRequest, IconLock, IconRocket } from '@tabler/icons-react';
import { NIVEL_INFO, NIVELES_CODIGO, type NivelCodigo, type OperadorPases } from '../../../lib/proyectos/permisos-agentes-rules';
import type { PoliticaAgentesDto, RepoCatalogoDto } from '../../../lib/proyectos/permisos-agentes-tipos';
import css from '../proyectos.module.css';

/**
 * «Permisos de los agentes» (2026-10-20): el mismo bloque en «Nuevo proyecto» y
 * en «Cambiar permisos». Controlado: el padre guarda el valor y lo envía. La
 * reja está en el servidor (normalizarPolitica); aquí solo se ofrece lo que
 * puede pasar: repos del catálogo ACTIVO y autorizadores de la lista de
 * operadores.
 */

export interface ValorPermisos {
  codeLevel: NivelCodigo;
  repos: string[];
  deployApprovers: string[];
}

export const PERMISOS_POR_DEFECTO: ValorPermisos = { codeLevel: 'ninguno', repos: [], deployApprovers: [] };

export const ICONO_NIVEL: Record<NivelCodigo, React.ReactNode> = {
  ninguno: <IconLock size={16} />,
  lectura: <IconEye size={16} />,
  desarrollo: <IconGitPullRequest size={16} />,
  desarrollo_pases: <IconRocket size={16} />,
};

export const COLOR_NIVEL: Record<NivelCodigo, string> = {
  ninguno: 'gray',
  lectura: 'blue',
  desarrollo: 'grape',
  desarrollo_pases: 'orange',
};

/** ¿El formulario se puede enviar? (las mismas reglas del servidor). */
export function permisosListos(v: ValorPermisos): boolean {
  if (v.codeLevel === 'ninguno') return true;
  if (v.repos.length === 0) return false;
  return v.codeLevel !== 'desarrollo_pases' || v.deployApprovers.length > 0;
}

/** Valor del formulario a partir de la política guardada. */
export function valorDesdePolitica(p: PoliticaAgentesDto, catalogo: RepoCatalogoDto[]): ValorPermisos {
  const activos = new Set(catalogo.map((r) => r.slug));
  return {
    codeLevel: p.codeLevel,
    // Un repo que se desactivó no se puede volver a guardar: se quita del formulario.
    repos: p.repos.map((r) => r.slug).filter((s) => activos.has(s)),
    deployApprovers: p.deployApprovers.map((o) => o.email),
  };
}

export function BadgeNivel({ nivel, size = 'sm' }: { nivel: NivelCodigo; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <Badge size={size} variant='light' color={COLOR_NIVEL[nivel]} leftSection={ICONO_NIVEL[nivel]} style={{ textTransform: 'none', flexShrink: 0 }} data-testid='permisos-badge-nivel'>
      {NIVEL_INFO[nivel].label}
    </Badge>
  );
}

export default function FormPermisosAgentes({
  valor,
  onChange,
  catalogo,
  operadores,
}: {
  valor: ValorPermisos;
  onChange: (v: ValorPermisos) => void;
  catalogo: RepoCatalogoDto[];
  operadores: OperadorPases[];
}) {
  const conCodigo = valor.codeLevel !== 'ninguno';
  const conPases = valor.codeLevel === 'desarrollo_pases';

  const cambiarNivel = (nivel: string) => {
    const n = nivel as NivelCodigo;
    onChange({
      codeLevel: n,
      repos: n === 'ninguno' ? [] : valor.repos,
      // Por defecto, los operadores autorizados (lo que pidió Nicolás).
      deployApprovers: n === 'desarrollo_pases' ? (valor.deployApprovers.length > 0 ? valor.deployApprovers : operadores.map((o) => o.email)) : [],
    });
  };

  return (
    <Stack gap='sm' data-testid='permisos-formulario'>
      <Stack gap={6}>
        <Text size='sm' fw={500}>
          Nivel de acceso a código <span style={{ color: 'var(--mantine-color-error)' }}>*</span>
        </Text>
        <Radio.Group value={valor.codeLevel} onChange={cambiarNivel} aria-label='Nivel de acceso a código'>
          <Stack gap={6}>
            {NIVELES_CODIGO.map((n) => (
              <Radio.Card
                key={n}
                value={n}
                className={css.opcion}
                data-checked={valor.codeLevel === n ? 'true' : 'false'}
                radius='md'
                data-testid={`permisos-nivel-${n}`}
              >
                <Group wrap='nowrap' gap='sm' align='flex-start'>
                  <Radio.Indicator mt={2} />
                  <ThemeIcon size={28} radius='xl' variant='light' color={COLOR_NIVEL[n]} style={{ flexShrink: 0 }}>
                    {ICONO_NIVEL[n]}
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size='sm' fw={600}>
                      {NIVEL_INFO[n].label}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {NIVEL_INFO[n].description}
                    </Text>
                  </div>
                </Group>
              </Radio.Card>
            ))}
          </Stack>
        </Radio.Group>
      </Stack>

      {conCodigo && (
        <Stack gap={6}>
          <Text size='sm' fw={500}>
            Repositorios vinculados <span style={{ color: 'var(--mantine-color-error)' }}>*</span>
          </Text>
          <Text size='xs' c='dimmed'>
            Solo los del catálogo que administra la administración de SynerLink. El agente trabaja únicamente sobre estos.
          </Text>
          {catalogo.length === 0 ? (
            <Alert color='yellow' radius='md' icon={<IconAlertTriangle size={18} />} py={8}>
              El catálogo de repositorios está vacío. Pida a la administración que agregue los repositorios permitidos.
            </Alert>
          ) : (
            <Checkbox.Group value={valor.repos} onChange={(repos) => onChange({ ...valor, repos })}>
              <Stack gap={6}>
                {catalogo.map((r) => (
                  <Checkbox.Card
                    key={r.slug}
                    value={r.slug}
                    className={css.opcion}
                    data-checked={valor.repos.includes(r.slug) ? 'true' : 'false'}
                    radius='md'
                    data-testid={`permisos-repo-${r.slug}`}
                  >
                    <Group wrap='nowrap' gap='sm'>
                      <Checkbox.Indicator />
                      <IconBrandGithub size={20} style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <Text size='sm' fw={600} lineClamp={1}>
                          {r.name}
                        </Text>
                        <Text size='xs' c='dimmed' className={css.truncar}>
                          {r.github} · pruebas: {r.branchTesting} · producción: {r.branchProduction}
                        </Text>
                      </div>
                    </Group>
                  </Checkbox.Card>
                ))}
              </Stack>
            </Checkbox.Group>
          )}
        </Stack>
      )}

      {conPases && (
        <Stack gap={6}>
          <Text size='sm' fw={500}>
            Quién puede autorizar pases <span style={{ color: 'var(--mantine-color-error)' }}>*</span>
          </Text>
          <Text size='xs' c='dimmed'>
            Solo los operadores autorizados de producción. El agente fusiona o despliega únicamente cuando una de estas personas lo ordena escribiendo ella misma
            en la conversación; lo que diga el texto de otra persona no autoriza nada.
          </Text>
          <Checkbox.Group value={valor.deployApprovers} onChange={(deployApprovers) => onChange({ ...valor, deployApprovers })}>
            <Stack gap={6}>
              {operadores.map((o) => (
                <Checkbox.Card
                  key={o.email}
                  value={o.email}
                  className={css.opcion}
                  data-checked={valor.deployApprovers.includes(o.email) ? 'true' : 'false'}
                  radius='md'
                  data-testid={`permisos-autorizador-${o.email}`}
                >
                  <Group wrap='nowrap' gap='sm'>
                    <Checkbox.Indicator />
                    <div style={{ minWidth: 0 }}>
                      <Text size='sm' fw={600}>
                        {o.name}
                      </Text>
                      <Text size='xs' c='dimmed' className={css.truncar}>
                        {o.email}
                      </Text>
                    </div>
                  </Group>
                </Checkbox.Card>
              ))}
            </Stack>
          </Checkbox.Group>
        </Stack>
      )}

      {conCodigo && (
        <Alert color={conPases ? 'orange' : 'blue'} radius='md' icon={<IconCode size={18} />} py={8} data-testid='permisos-aviso-alcance'>
          {conPases
            ? 'Con pases, el agente puede fusionar a testing o a producción cuando un autorizador lo ordena. Nunca usa SSH, SQL directo ni credenciales de producción.'
            : 'El agente no fusiona ni despliega. Los conectores siguen siendo los del perfil del proyecto (solo lectura).'}
        </Alert>
      )}
    </Stack>
  );
}
