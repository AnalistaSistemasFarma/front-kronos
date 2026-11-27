import { describe, expect, it } from 'vitest';
import { armarCuerpoReenvio, avisoMensajeReenviado, neutralizarMenciones } from '../reenviar-mensaje-rules';
import { extraerMenciones, resolverAgentesMencionados } from '../groups';

describe('Reenviar un mensaje · reglas', () => {
  it('neutraliza las menciones del original pero deja los correos', () => {
    const t = neutralizarMenciones('@zoe mire esto y escriba a ana@gss.com (@horus)');
    expect(t).toContain('ana@gss.com');
    expect(extraerMenciones(t)).toEqual([]);
    expect(extraerMenciones('@zoe y (@horus)')).toEqual(['zoe', 'horus']);
  });

  it('una mención neutralizada ya no despierta al agente', () => {
    const zoe = { idAgent: 5, code: 'zoe', displayName: 'Zoe', handle: 'zoe' };
    expect(resolverAgentesMencionados('@zoe hola', [zoe]).length).toBe(1);
    expect(resolverAgentesMencionados(neutralizarMenciones('@zoe hola'), [zoe]).length).toBe(0);
  });

  it('arma comentario, encabezado y original en ese orden', () => {
    const b = armarCuerpoReenvio({ nota: 'Para su revisión', autor: 'Or*us_', original: 'Texto original' });
    expect(b).toBe('Para su revisión\n\n↪️ **Reenviado · mensaje de Orus**\n\nTexto original');
  });

  it('sin comentario ni texto (solo adjuntos) queda el encabezado', () => {
    expect(armarCuerpoReenvio({ nota: ' ', autor: 'Ana', original: '' })).toBe('↪️ **Reenviado · mensaje de Ana**');
  });

  it('aviso para persona, grupo y proyecto', () => {
    expect(avisoMensajeReenviado({ titulo: 'Ana', tipo: 'persona' })).toBe('Mensaje reenviado a Ana.');
    expect(avisoMensajeReenviado({ titulo: 'TI', tipo: 'grupo' })).toBe('Mensaje reenviado al grupo TI.');
    expect(avisoMensajeReenviado({ titulo: 'Mejoras', tipo: 'proyecto' })).toBe('Mensaje reenviado al proyecto Mejoras.');
  });
});
