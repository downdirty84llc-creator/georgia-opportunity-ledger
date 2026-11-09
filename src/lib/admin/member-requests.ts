export const REQUEST_CONFIG = {
  corrections: {
    title: 'Corrections',
    table: 'correction_requests',
    roles: ['reviewer', 'editor', 'super_administrator'],
    statuses: [
      'submitted',
      'under_review',
      'accepted',
      'rejected',
      'published',
    ],
    complete: ['rejected', 'published'],
  },
  support: {
    title: 'Support requests',
    table: 'support_tickets',
    roles: ['support_representative', 'billing_manager', 'super_administrator'],
    statuses: [
      'open',
      'awaiting_customer',
      'awaiting_internal',
      'resolved',
      'closed',
    ],
    complete: ['resolved', 'closed'],
  },
} as const;
export type RequestKind = keyof typeof REQUEST_CONFIG;
export function canReviewRequests(kind: RequestKind, role: string) {
  return (REQUEST_CONFIG[kind].roles as readonly string[]).includes(role);
}
