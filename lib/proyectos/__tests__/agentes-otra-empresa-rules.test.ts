import { describe, expect, it } from 'vitest';
import { resolverConectoresAgente } from '../agentes-otra-empresa-rules';
import { construirConfig } from '../config-agentes-rules';

/* Agentes de OTRA empresa en un proyecto (2026-11-25, msg 39725): reglas puras. */
const GSS = 8;
const OLP = 3;
const RYAN = 5;
const base = { code: 'doki', idCompanyProyecto: GSS, perfilProyecto: 'gss' };

describe('resolverConectoresAgente', () => {
  it('de la empresa del proyecto: el perfil del proyecto si está habilitado ahí, o nada', () => {
    const config = construirConfig([], new Map([['doki', ['gss']]]));
    expect(resolverConectoresAgente({ ...base, perteneceAEmpresaProyecto: true, empresasDeQuienLoAgrego: [], config })).toEqual({
      perfil: 'gss',
      idCompany: GSS,
      otraEmpresa: false,
    });
    const sinPerfil = construirConfig([], new Map([['doki', ['olp']]]));
    expect(resolverConectoresAgente({ ...base, perteneceAEmpresaProyecto: true, empresasDeQuienLoAgrego: [OLP], config: sinPerfil })).toBeNull();
  });

  it('de OTRA empresa: el primer perfil de SU empresa, nunca el del proyecto', () => {
    const config = construirConfig(
      [
        { idCompany: OLP, idAgent: 43, code: 'doki', enabled: true, profiles: 'olp' },
        { idCompany: GSS, idAgent: 43, code: 'doki', enabled: true, profiles: 'gss' },
      ],
      new Map()
    );
    expect(resolverConectoresAgente({ ...base, perteneceAEmpresaProyecto: false, empresasDeQuienLoAgrego: [GSS, OLP], config })).toEqual({
      perfil: 'olp',
      idCompany: OLP,
      otraEmpresa: true,
    });
  });

  it('de OTRA empresa: la de menor id donde está habilitado; sin ninguna, nada', () => {
    const config = construirConfig(
      [
        { idCompany: OLP, idAgent: 43, code: 'doki', enabled: false, profiles: 'olp' },
        { idCompany: RYAN, idAgent: 43, code: 'doki', enabled: true, profiles: 'ryan' },
      ],
      new Map()
    );
    expect(resolverConectoresAgente({ ...base, perteneceAEmpresaProyecto: false, empresasDeQuienLoAgrego: [RYAN, OLP], config })).toMatchObject({
      perfil: 'ryan',
      idCompany: RYAN,
    });
    expect(resolverConectoresAgente({ ...base, perteneceAEmpresaProyecto: false, empresasDeQuienLoAgrego: [OLP], config })).toBeNull();
    expect(resolverConectoresAgente({ ...base, perteneceAEmpresaProyecto: false, empresasDeQuienLoAgrego: [], config })).toBeNull();
  });
});
