import { redirect } from 'next/navigation';
import { getRequesterPanelUrl } from '@/lib/help-desk/subprocessRoles';

export default function TicketsMyTicketsRedirectPage() {
  redirect(getRequesterPanelUrl());
}
