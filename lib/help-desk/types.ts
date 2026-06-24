  export interface HelpDeskCaseListItem {
  id_case: number;
  subject_case: string;
  priority: string;
  status: string;
  creation_date: string;
  nombreTecnico: string;
  subprocess_id?: number;
  company: string;
  id_company?: number;
  requester?: number | string;
  requester_name?: string;
  requester_email?: string;
  /** c.email normalizado desde API (contact_email). */
  email?: string;
  contact_email?: string | null;
  case_type?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  activity?: string;
  department?: string;
  id_status_case?: number;
  resolution?: string;
  end_date?: string;
}
