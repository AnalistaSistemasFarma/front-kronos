import { describe, expect, it } from 'vitest';
import { loadTeamsGraphConfig, transcriptToText } from '../src/teams.js';

describe('Teams Graph helpers', () => {
  it('deriva el usuario de Graph desde MICROSOFTGRAPHUSERROUTE', () => {
    expect(
      loadTeamsGraphConfig({
        MICROSOFTCLIENTID: 'client-id',
        MICROSOFTCLIENTSECRET: 'client-secret',
        MICROSOFTTENANTID: 'tenant-id',
        MICROSOFTGRAPHUSERROUTE: 'https://graph.microsoft.com/v1.0/users/user-123/drive/',
      })
    ).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tenantId: 'tenant-id',
      userId: 'user-123',
    });
  });

  it('prefiere MICROSOFTGRAPHUSERID explícito', () => {
    expect(
      loadTeamsGraphConfig({
        MICROSOFTCLIENTID: 'client-id',
        MICROSOFTCLIENTSECRET: 'client-secret',
        MICROSOFTTENANTID: 'tenant-id',
        MICROSOFTGRAPHUSERID: 'explicit-user',
      }).userId
    ).toBe('explicit-user');
  });

  it('limpia el transcript sin atribución de hablante', () => {
    expect(
      transcriptToText(`WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBuenos días\n\n00:00:03.000 --> 00:00:04.000\nEquipo presente`)
    ).toBe('Buenos días\nEquipo presente');
  });
});
