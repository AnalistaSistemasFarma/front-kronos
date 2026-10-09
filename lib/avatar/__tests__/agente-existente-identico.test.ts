import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agentAvatarDataUri, agentAvatarPorDefecto, composeAgentAvatarSvg, kindDe, parseAgentAvatarConfig, serializeAgentAvatarConfig } from '../agente';
import { composeAvatarSvg, parseAvatarConfig, serializeAvatarConfig, sugerenciaParaAgente } from '../compose';
import { svgResponse } from '../http';

/**
 * El cambio de figuras es ADITIVO (aclaración de Nicolás Rivera, c47 msg 15776):
 * los avatares de agentes YA guardados (config v3 de persona Lorelei, sin `kind`)
 * no se migran y se dibujan IDÉNTICOS a antes.
 *
 * ANTES = huellas SHA-256 generadas con el código de testing previo a las figuras
 * (commit b121de6, merge del #553): svgResponse hacía
 * composeAvatarSvg(parseAvatarConfig(json, 'agent'), { title }) y el Perfil
 * avatarDataUri(config). Si algo de las figuras alterara un avatar existente,
 * estas huellas dejarían de coincidir.
 */
const ANTES: Record<string, { json: string; svg: string; uri: string }> = {
  "Atlas": {
    "json": "{\"v\":3,\"estilo\":\"lorelei\",\"seed\":\"Atlas\",\"hair\":\"variant37\",\"head\":\"variant01\",\"eyes\":\"variant22\",\"eyebrows\":\"variant06\",\"mouth\":\"happy02\",\"nose\":\"variant03\",\"glasses\":null,\"earrings\":null,\"beard\":null,\"freckles\":null,\"hairAccessories\":null,\"hairColor\":\"000000\",\"skinColor\":\"ffffff\",\"backgroundColor\":\"f2f2f2\",\"flip\":false}",
    "svg": "11625b39ac873f355143669ac0a38d68232fc100f97900160c77806cf5f7bd10",
    "uri": "51eb887617c6df6cc564589e081e0a52fe6b17966c3bfef8af965356a1690cae"
  },
  "Galileo": {
    "json": "{\"v\":3,\"estilo\":\"lorelei\",\"seed\":\"Galileo\",\"hair\":\"variant01\",\"head\":\"variant02\",\"eyes\":\"variant02\",\"eyebrows\":\"variant08\",\"mouth\":\"happy03\",\"nose\":\"variant03\",\"glasses\":null,\"earrings\":\"variant01\",\"beard\":null,\"freckles\":null,\"hairAccessories\":null,\"hairColor\":\"000000\",\"skinColor\":\"ffffff\",\"backgroundColor\":\"f2f2f2\",\"flip\":false}",
    "svg": "597bd2b367a063e8a75149facccf52a6d72cd39cbe49078711285c61026e49ac",
    "uri": "1a3d2d052f6ce757f4f38b3624d345b166fcbe524d217006deabb9140041d29a"
  },
  "Kepler": {
    "json": "{\"v\":3,\"estilo\":\"lorelei\",\"seed\":\"Kepler\",\"hair\":\"variant06\",\"head\":\"variant03\",\"eyes\":\"variant23\",\"eyebrows\":\"variant12\",\"mouth\":\"happy08\",\"nose\":\"variant06\",\"glasses\":null,\"earrings\":null,\"beard\":null,\"freckles\":null,\"hairAccessories\":null,\"hairColor\":\"000000\",\"skinColor\":\"ffffff\",\"backgroundColor\":\"f2f2f2\",\"flip\":false}",
    "svg": "25de398fcc80596d17b5b5ddaf52a98198de3b90deb1c523a37df4271f1f4921",
    "uri": "4d39daafecad4aa7755550f9a08a34dc24369fdcfb2569217e2eefb9cc2a2874"
  },
  "Mercurio": {
    "json": "{\"v\":3,\"estilo\":\"lorelei\",\"seed\":\"Mercurio\",\"hair\":\"variant22\",\"head\":\"variant04\",\"eyes\":\"variant09\",\"eyebrows\":\"variant01\",\"mouth\":\"happy05\",\"nose\":\"variant02\",\"glasses\":null,\"earrings\":null,\"beard\":null,\"freckles\":null,\"hairAccessories\":null,\"hairColor\":\"000000\",\"skinColor\":\"ffffff\",\"backgroundColor\":\"f2f2f2\",\"flip\":false}",
    "svg": "c23f37924c3501a2917e56dbc94d2a95e03173abdd85edd50041af781f49cacb",
    "uri": "e348b958b966d3e37e655231e7af8e7dc3d7cfd3b0c5193a80733ea1d4a05449"
  },
  "Orión": {
    "json": "{\"v\":3,\"estilo\":\"lorelei\",\"seed\":\"Orión\",\"hair\":\"variant30\",\"head\":\"variant02\",\"eyes\":\"variant16\",\"eyebrows\":\"variant08\",\"mouth\":\"happy15\",\"nose\":\"variant03\",\"glasses\":\"variant03\",\"earrings\":null,\"beard\":\"variant02\",\"freckles\":null,\"hairAccessories\":null,\"hairColor\":\"000000\",\"skinColor\":\"ffffff\",\"backgroundColor\":\"f2f2f2\",\"flip\":false}",
    "svg": "16dae8fef589e5e1f75a9ef4963ef1f9deface34581ffd16f3b378a55c3851aa",
    "uri": "186a31a2c5e23a308d4abe834e42de4c7b912597d5e4dceac320d32da2d780d7"
  },
  "Sirio": {
    "json": "{\"v\":3,\"estilo\":\"lorelei\",\"seed\":\"Sirio\",\"hair\":\"variant03\",\"head\":\"variant04\",\"eyes\":\"variant23\",\"eyebrows\":\"variant12\",\"mouth\":\"happy15\",\"nose\":\"variant02\",\"glasses\":null,\"earrings\":null,\"beard\":null,\"freckles\":null,\"hairAccessories\":null,\"hairColor\":\"000000\",\"skinColor\":\"ffffff\",\"backgroundColor\":\"f2f2f2\",\"flip\":false}",
    "svg": "f02c7df9c4b7487e22e0c83097e8da6d3bd9bf66b46e4f4050599bcba01ae4db",
    "uri": "476a78a72e097cee38e07e0fe26c744431fc52c1c635b4a2856f5268c9d41e6b"
  },
  "Vega": {
    "json": "{\"v\":3,\"estilo\":\"lorelei\",\"seed\":\"Vega\",\"hair\":\"variant15\",\"head\":\"variant01\",\"eyes\":\"variant15\",\"eyebrows\":\"variant07\",\"mouth\":\"happy11\",\"nose\":\"variant06\",\"glasses\":null,\"earrings\":null,\"beard\":null,\"freckles\":null,\"hairAccessories\":null,\"hairColor\":\"000000\",\"skinColor\":\"ffffff\",\"backgroundColor\":\"f2f2f2\",\"flip\":false}",
    "svg": "6edbbbcf8b0347f98afa3886299cef015c6da91a5a26807ab0a2d05aa83ca975",
    "uri": "c2c59041a398fe98871a5091e3011abd59c7c51650fbf689ff82ff2f30bdbaba"
  }
};

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('avatares de agentes existentes: idénticos antes y después de las figuras', () => {
  for (const [nombre, antes] of Object.entries(ANTES)) {
    it(`${nombre}: el config v3 guardado se trata como persona y se dibuja igual`, async () => {
      const config = parseAgentAvatarConfig(antes.json);
      expect(config).not.toBeNull();
      expect(kindDe(config!)).toBe('persona');
      expect('kind' in (config as object)).toBe(false);
      // Mismo JSON al volver a guardarlo: no hay migración de formato.
      expect(serializeAgentAvatarConfig(config!)).toBe(antes.json);
      // Endpoint /api/avatar/agent/<code> y vista previa del Perfil: byte a byte iguales.
      expect(sha(composeAgentAvatarSvg(config!, { title: nombre }))).toBe(antes.svg);
      expect(sha(agentAvatarDataUri(config!))).toBe(antes.uri);
      const res = svgResponse(antes.json, nombre, 1, 'agent');
      expect(res.status).toBe(200);
      expect(sha(await res.text())).toBe(antes.svg);
      // Y coincide con el camino viejo ejecutado hoy.
      expect(composeAgentAvatarSvg(config!, { title: nombre })).toBe(composeAvatarSvg(parseAvatarConfig(antes.json, 'agent')!, { title: nombre }));
    });
  }

  it('un agente sin avatar sigue arrancando con la persona Lorelei de hoy', () => {
    for (const nombre of Object.keys(ANTES)) {
      expect(agentAvatarPorDefecto('persona', nombre)).toEqual(sugerenciaParaAgente(nombre));
      expect(serializeAvatarConfig(sugerenciaParaAgente(nombre))).toBe(ANTES[nombre].json);
    }
  });

  it('los avatares de usuarios no cambian: solo v3 Lorelei, el mismo SVG', async () => {
    const json = ANTES.Vega.json.replace('happy11', 'sad03');
    const res = svgResponse(json, 'Usuario', 1, 'user');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(composeAvatarSvg(parseAvatarConfig(json, 'user')!, { title: 'Usuario' }));
    expect(svgResponse('{"v":4,"kind":"animal","variante":"gato","cara":"feliz","extra":null,"relleno":"ffffff","acento":"000000","fondo":"f2f2f2"}', 'U', 1, 'user').status).toBe(404);
  });
});
