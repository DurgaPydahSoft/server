/**
 * Phase 2 dual-read helpers: map HostelRequest → Students list DTO fields
 * so existing UI (Active / Expired) keeps working while exposing request status.
 */

export const normalizeAdmissionNumber = (value) =>
  (value || '').toString().trim().toUpperCase();

/** Map canonical request status → User.applicationStatus used by Students UI */
export const mapHostelRequestStatusToLegacy = (status) => {
  switch (status) {
    case 'active':
      return { applicationStatus: 'Active' };
    case 'expired':
      return { applicationStatus: 'Expired' };
    case 'cancelled':
      return { applicationStatus: 'Withdrawn' };
    default:
      return { applicationStatus: 'Active' };
  }
};

/**
 * Prefer HostelRequest allocation + status over occupancy-history overlay.
 * Safe no-op when request is missing (legacy students before backfill).
 */
export const overlayStudentWithHostelRequest = (student, request, requestedYear) => {
  if (!request) return student;

  const legacy = mapHostelRequestStatusToLegacy(request.status);
  const hostel =
    request.hostelId && typeof request.hostelId === 'object'
      ? request.hostelId
      : request.hostelId || student.hostel;
  const hostelCategory =
    request.hostelCategoryId && typeof request.hostelCategoryId === 'object'
      ? request.hostelCategoryId
      : request.hostelCategoryId || student.hostelCategory;

  const currentAcademicYear = student.currentAcademicYear || student.academicYear;
  const requestYear = request.academicYear || requestedYear;

  return {
    ...student,
    academicYear: requestYear || student.academicYear,
    currentAcademicYear,
    roomNumber: request.roomNumber ?? student.roomNumber,
    bedNumber: request.bedNumber ?? student.bedNumber,
    lockerNumber: request.lockerNumber ?? student.lockerNumber,
    room: request.roomId ?? student.room,
    hostel,
    hostelCategory,
    category:
      (typeof hostelCategory === 'object' && hostelCategory?.name) ||
      student.category ||
      '',
    course: request.sdmsCourse || student.course,
    branch: request.sdmsBranch || student.branch,
    year: request.sdmsYearOfStudy ?? student.year,
    batch: request.sdmsBatch || student.batch,
    applicationStatus: legacy.applicationStatus,
    // Compatibility alias for older UI that still reads hostelStatus
    hostelStatus:
      legacy.applicationStatus === 'Active' || legacy.applicationStatus === 'Extended'
        ? 'Active'
        : 'Inactive',
    hostelRequestId: request._id,
    hostelRequestStatus: request.status,
    hostelSequenceId: request.hostelSequenceId,
    allocatedFrom: request.allocatedAt || student.allocatedFrom,
    allocatedTo: request.expiredAt || request.cancelledAt || student.allocatedTo,
    actualExpiredAt: request.expiredAt || student.actualExpiredAt,
    isHistoricalView: currentAcademicYear
      ? currentAcademicYear !== requestYear
      : Boolean(student.isHistoricalView)
  };
};
