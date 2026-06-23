import { redirect } from 'next/navigation';

export default function CasesByEmailRedirectPage() {
  redirect('/process/help-desk/my-tickets');
}
