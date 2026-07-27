import { redirect } from 'next/navigation';

// Kept for old bookmarks and links created before Campaign Centre and Draft
// Review were merged into the single Email Drafts workbench.
export default function LegacyDraftReviewPage() {
  redirect('/client-communications/campaigns');
}
