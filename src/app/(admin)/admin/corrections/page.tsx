import type { Metadata } from 'next';
import { MemberRequestQueue } from '@/components/admin/member-request-queue';
export const metadata: Metadata = {
  title: 'Corrections',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  return <MemberRequestQueue kind="corrections" searchParams={searchParams} />;
}
