import type { InviteRequestStatus } from '@voz/shared';

// Re-approval of a denied request is intentional: someone may reach out after a
// denial and the admin can flip them. An already-approved request is a no-op.
export function canApprove(status: InviteRequestStatus): boolean {
  return status === 'pending' || status === 'denied';
}

export function canDeny(status: InviteRequestStatus): boolean {
  return status === 'pending';
}
