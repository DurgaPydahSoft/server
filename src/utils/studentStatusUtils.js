/**
 * Student identity lifecycle lives on User.applicationStatus.
 * Yearly hostel allocation lifecycle lives on HostelRequest.status.
 * Do not use User.hostelStatus in new code.
 */

export const ACTIVE_APPLICATION_STATUSES = ['Active', 'Extended'];
export const INACTIVE_APPLICATION_STATUSES = ['Expired', 'Withdrawn'];

/** Mongo filter for students with an active application */
export const activeApplicationQuery = {
  applicationStatus: { $in: ACTIVE_APPLICATION_STATUSES }
};

/** Mongo filter for students with an inactive/expired application */
export const inactiveApplicationQuery = {
  applicationStatus: { $in: INACTIVE_APPLICATION_STATUSES }
};

export const isApplicationActive = (studentOrStatus) => {
  const status =
    typeof studentOrStatus === 'string'
      ? studentOrStatus
      : studentOrStatus?.applicationStatus;
  return ACTIVE_APPLICATION_STATUSES.includes(status);
};

export const isApplicationInactive = (studentOrStatus) => {
  const status =
    typeof studentOrStatus === 'string'
      ? studentOrStatus
      : studentOrStatus?.applicationStatus;
  return INACTIVE_APPLICATION_STATUSES.includes(status) || status === 'Expired';
};

/**
 * Map filter query param (legacy hostelStatus Active/Inactive/active/expired/cancelled)
 * to applicationStatus / HostelRequest-oriented semantics.
 */
export const normalizeStatusFilter = (value) => {
  if (!value) return null;
  const v = String(value).toLowerCase();
  if (v === 'active') return 'active';
  if (v === 'inactive' || v === 'expired') return 'expired';
  if (v === 'cancelled' || v === 'withdrawn') return 'cancelled';
  return v;
};
