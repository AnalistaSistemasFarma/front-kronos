/**
 * DTOs of the meetings per project (2026-11-24) shared by the API routes and the screens. No server
 * imports: safe in the browser.
 */
import type { SpeakerShare } from '../metrics';
import type { MeetingAnalysisResult } from './analysis-rules';
import type { MeetingOrigin, ProjectMeetingsKpis, SuggestionReason } from './rules';

/** Project column of one meeting in «Mis reuniones». */
export interface MeetingProjectItemDto {
  canAssign: boolean;
  /** Linked: the project name only when the person is a member of it. */
  link?: { linkId: number | null; idProject: number | null; projectName: string | null; origin: MeetingOrigin };
  suggestion?: { idProject: number; projectName: string; reason: SuggestionReason };
  rule?: { idRule: number; idProject: number; projectName: string | null };
}

export interface MeetingsProjectsDto {
  available: boolean;
  error?: string;
  projects: { idProject: number; name: string }[];
  items: Record<string, MeetingProjectItemDto>;
}

export type AnalysisStatus = 'analizando' | 'listo' | 'fallido';

export interface ProjectMeetingDto {
  id: number;
  subject: string;
  start: string;
  end: string;
  scheduledMinutes: number;
  actualMinutes: number | null;
  startDelayMinutes: number | null;
  organizerName: string | null;
  attendeesCount: number;
  attendedCount: number | null;
  online: boolean;
  hasTranscript: boolean | null;
  summary: string | null;
  origin: MeetingOrigin;
  linkedBy: string;
  linkedByMe: boolean;
  canRemove: boolean;
  analysis: {
    id: number;
    status: AnalysisStatus;
    score: number | null;
    decisions: number;
    commitments: number;
    proposals: number;
    proposalsConfirmed: number;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
}

export interface ProjectMeetingRuleDto {
  id: number;
  subject: string;
  createdBy: string;
  createdAt: string;
  canDelete: boolean;
}

export interface ProjectMeetingsDto {
  days: number;
  meetings: ProjectMeetingDto[];
  rules: ProjectMeetingRuleDto[];
  kpis: ProjectMeetingsKpis;
  viewer: { meetingsEnabled: boolean; canAssign: boolean };
}

/** Indicators without AI stored with the analysis. `participation` only goes to attendees. */
export interface AnalysisMetrics {
  scheduledMinutes: number;
  actualMinutes: number | null;
  startDelayMinutes: number | null;
  overrunMinutes: number | null;
  attendeesCount: number;
  attendedCount: number | null;
  speakers: number;
  silentAttendees: number | null;
  participation?: SpeakerShare[];
  transcriptTruncated: boolean;
}

export interface MeetingAnalysisDto {
  id: number;
  status: AnalysisStatus;
  agent: { idAgent: number; displayName: string; code: string } | null;
  requestedBy: string;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  result: MeetingAnalysisResult | null;
  metrics: AnalysisMetrics | null;
  proposals: { id: number; status: string; summary: string }[];
  /** The viewer attended (participation by person and transcript are only for attendees). */
  viewerAttended: boolean;
  canRequest: boolean;
}
