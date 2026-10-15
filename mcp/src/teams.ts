/**
 * Cliente de Microsoft Graph para consultar reuniones y transcripciones de
 * Teams. Usa las mismas credenciales app-only del MCP de Kronos, pero no
 * comparte el cliente de OneDrive porque las rutas y los formatos de
 * respuesta son distintos.
 *
 * Variables reutilizadas del .env del MCP:
 *   - MICROSOFTCLIENTID
 *   - MICROSOFTCLIENTSECRET
 *   - MICROSOFTTENANTID
 *   - MICROSOFTGRAPHUSERROUTE (se extrae /users/<id>/drive/)
 *
 * La aplicación debe tener permisos de aplicación, con consentimiento de
 * administrador, para Calendars.Read, OnlineMeetings.Read.All y
 * OnlineMeetingTranscript.Read.All.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface TeamsGraphConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  userId: string;
}

export interface TeamsMeeting {
  subject: string | null;
  start: string | null;
  end: string | null;
  organizer: string | null;
  isOnlineMeeting: boolean;
  joinUrl: string | null;
  webUrl: string | null;
}

export interface TeamsTranscript {
  transcriptId: string;
  created: string | null;
  meetingOrganizerId: string | null;
}

export function loadTeamsGraphConfig(env: NodeJS.ProcessEnv = process.env): TeamsGraphConfig | null {
  const clientId = env.MICROSOFTCLIENTID?.trim();
  const clientSecret = env.MICROSOFTCLIENTSECRET?.trim();
  const tenantId = env.MICROSOFTTENANTID?.trim();
  const explicitUserId = env.MICROSOFTGRAPHUSERID?.trim();
  const route = env.MICROSOFTGRAPHUSERROUTE?.trim();
  const routeUserId = route?.match(/\/users\/([^/]+)\/drive\/?$/i)?.[1];
  const userId = explicitUserId || routeUserId;

  if (!clientId || !clientSecret || !tenantId || !userId) return null;
  if (clientId.startsWith('your-') || tenantId.startsWith('your-')) return null;

  return { clientId, clientSecret, tenantId, userId };
}

export class TeamsGraphClient {
  private readonly cfg: TeamsGraphConfig;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(cfg: TeamsGraphConfig) {
    this.cfg = cfg;
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 60_000) return this.token;

    const url = `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(`No se pudo obtener token de Microsoft Graph (${response.status}).`);

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('Microsoft Graph no devolvió access_token.');
    this.token = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000;
    return this.token;
  }

  private async request(url: string, accept?: string): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.getToken()}` };
    if (accept) headers.Accept = accept;
    const response = await fetch(url, { headers });
    if (response.ok) return response;

    let detail = '';
    try {
      const body = (await response.json()) as { error?: { message?: string; innerError?: { code?: string } } };
      const error = body.error;
      detail = [error?.innerError?.code, error?.message].filter(Boolean).join(': ');
    } catch {
      detail = (await response.text().catch(() => '')).slice(0, 300);
    }
    throw new Error(`Microsoft Graph Teams ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  private userPath(path: string): string {
    return `${GRAPH}/users/${encodeURIComponent(this.cfg.userId)}${path}`;
  }

  async listMeetings(options: {
    daysBack: number;
    daysForward: number;
    limit: number;
    onlyOnline: boolean;
  }): Promise<TeamsMeeting[]> {
    const now = Date.now();
    const start = new Date(now - options.daysBack * 86_400_000).toISOString();
    const end = new Date(now + options.daysForward * 86_400_000).toISOString();
    const url = new URL(this.userPath('/calendarView'));
    url.searchParams.set('startDateTime', start);
    url.searchParams.set('endDateTime', end);
    url.searchParams.set('$select', 'subject,start,end,organizer,isOnlineMeeting,onlineMeeting,webLink');
    url.searchParams.set('$orderby', 'start/dateTime desc');
    url.searchParams.set('$top', String(Math.min(Math.max(options.limit, 1), 100)));

    const response = await this.request(url.toString());
    const data = (await response.json()) as { value?: Array<Record<string, any>> };
    const meetings = (data.value ?? []).map((event) => ({
      subject: event.subject ?? null,
      start: event.start?.dateTime ?? null,
      end: event.end?.dateTime ?? null,
      organizer: event.organizer?.emailAddress?.address ?? event.organizer?.emailAddress?.name ?? null,
      isOnlineMeeting: event.isOnlineMeeting === true,
      joinUrl: event.onlineMeeting?.joinUrl ?? null,
      webUrl: event.webLink ?? null,
    }));
    return options.onlyOnline ? meetings.filter((meeting) => meeting.isOnlineMeeting && meeting.joinUrl) : meetings;
  }

  async resolveMeetingId(joinUrl: string): Promise<string> {
    const url = new URL(this.userPath('/onlineMeetings'));
    url.searchParams.set('$filter', `joinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`);
    url.searchParams.set('$select', 'id,subject,startDateTime,endDateTime');
    const response = await this.request(url.toString());
    const data = (await response.json()) as { value?: Array<{ id?: string }> };
    const meetingId = data.value?.[0]?.id;
    if (!meetingId) throw new Error('No se encontró una reunión en línea para ese join_url.');
    return meetingId;
  }

  private async requireMeetingId(meetingId?: string, joinUrl?: string): Promise<string> {
    if (meetingId?.trim()) return meetingId.trim();
    if (joinUrl?.trim()) return this.resolveMeetingId(joinUrl.trim());
    throw new Error('Debe indicar meetingId o joinUrl.');
  }

  async listTranscripts(meetingId?: string, joinUrl?: string): Promise<{ meetingId: string; transcripts: TeamsTranscript[] }> {
    const resolvedMeetingId = await this.requireMeetingId(meetingId, joinUrl);
    const response = await this.request(
      this.userPath(`/onlineMeetings/${encodeURIComponent(resolvedMeetingId)}/transcripts`),
    );
    const data = (await response.json()) as { value?: Array<Record<string, any>> };
    return {
      meetingId: resolvedMeetingId,
      transcripts: (data.value ?? []).map((transcript) => ({
        transcriptId: String(transcript.id),
        created: transcript.createdDateTime ?? null,
        meetingOrganizerId: transcript.meetingOrganizer?.user?.id ?? null,
      })),
    };
  }

  async getTranscript(options: {
    meetingId?: string;
    joinUrl?: string;
    transcriptId?: string;
    format: 'text' | 'vtt';
  }): Promise<{ meetingId: string; transcriptId: string; content: string; format: 'text' | 'vtt' }> {
    const meetingId = await this.requireMeetingId(options.meetingId, options.joinUrl);
    let transcriptId = options.transcriptId?.trim();
    if (!transcriptId) {
      const listed = await this.listTranscripts(meetingId);
      const newest = listed.transcripts[listed.transcripts.length - 1];
      if (!newest) throw new Error('La reunión no tiene transcripciones disponibles.');
      transcriptId = newest.transcriptId;
    }

    // text evita la política SpeakerAttributionNotAllowed del tenant: Graph
    // devuelve utterances con timestamps, pero sin nombres de hablantes.
    const accept = options.format === 'vtt' ? 'text/vtt' : 'application/vnd.microsoft.graph.transcript+text';
    const response = await this.request(
      this.userPath(
        `/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content`,
      ),
      accept,
    );
    const content = await response.text();
    return {
      meetingId,
      transcriptId,
      content: options.format === 'text' ? transcriptToText(content) : content,
      format: options.format,
    };
  }
}

/** Convierte el formato sin speaker attribution en texto legible. */
export function transcriptToText(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== 'WEBVTT' && !line.startsWith('NOTE') && !line.includes('-->') && !/^\d+$/.test(line))
    .join('\n');
}
