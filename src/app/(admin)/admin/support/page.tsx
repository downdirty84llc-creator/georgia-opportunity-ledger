import type { Metadata } from 'next';
import { MemberRequestQueue } from '@/components/admin/member-request-queue';
export const metadata: Metadata = {
  title: 'Support requests',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  return <MemberRequestQueue kind="support" searchParams={searchParams} />;
}
