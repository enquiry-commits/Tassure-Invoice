import { redirect } from 'next/navigation';

export default function ARReminderPage() {
  redirect('/billing?tab=ar');
}
