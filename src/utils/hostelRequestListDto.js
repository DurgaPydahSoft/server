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
  // Stay dates are HostelRequest-only — never leak User.admitDate/joiningDate/leftDate
  if (!request) {
    return {
      ...student,
      admitDate: null,
      joiningDate: null,
      leftDate: null
    };
  }

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
    // When HostelRequest exists it owns allocation — do not fall back to stale User fields
    roomNumber: request.roomNumber ?? '',
    bedNumber: request.bedNumber ?? '',
    lockerNumber: request.lockerNumber ?? '',
    room: request.roomId ?? null,
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
    hostelRequestCreatedAt: request.createdAt,
    hostelSequenceId: request.hostelSequenceId,
    // AY-wise stay dates — HostelRequest is the only source of truth
    admitDate: request.admitDate ?? request.createdAt ?? null,
    joiningDate: request.joiningDate ?? null,
    leftDate: request.leftDate ?? null,
    allocatedFrom: request.allocatedAt || student.allocatedFrom,
    allocatedTo: request.expiredAt || request.cancelledAt || null,
    actualExpiredAt: request.expiredAt || null,
    isHistoricalView: currentAcademicYear
      ? currentAcademicYear !== requestYear
      : Boolean(student.isHistoricalView)
  };
};

const buildActiveHostelRequestLookup = (student) => {
  const orConditions = [];
  if (student?.admissionNumber) {
    orConditions.push({ admissionNumber: normalizeAdmissionNumber(student.admissionNumber) });
  }
  if (student?.rollNumber) {
    orConditions.push({ sdmsRollNumber: String(student.rollNumber).trim().toUpperCase() });
  }
  if (!orConditions.length) return null;
  return { status: 'active', $or: orConditions };
};

/** Resolve category/room/hostel from active HostelRequest when User cache is empty (CRM sync). */
export const applyActiveHostelRequestOverlay = async (student, requestedYear = null) => {
  const lookup = buildActiveHostelRequestLookup(student);
  if (!lookup) return student;

  const HostelRequest = (await import('../models/HostelRequest.js')).default;
  await import('../models/Hostel.js');
  await import('../models/HostelCategory.js');

  const year = requestedYear || student.academicYear;
  let activeReq = null;
  if (year) {
    activeReq = await HostelRequest.findOne({ ...lookup, academicYear: year })
      .populate('hostelCategoryId', 'name')
      .populate('hostelId', 'name')
      .populate('roomId')
      .lean();
  }
  if (!activeReq) {
    activeReq = await HostelRequest.findOne(lookup)
      .sort({ academicYear: -1, createdAt: -1 })
      .populate('hostelCategoryId', 'name')
      .populate('hostelId', 'name')
      .populate('roomId')
      .lean();
  }

  if (!activeReq) return student;
  return overlayStudentWithHostelRequest(student, activeReq, year);
};

export const resolveCategoryNameForPrint = (student) => {
  const raw = student?.category ?? student?.hostelCategory;
  if (raw && typeof raw === 'object') return raw.name || '';
  return String(raw || '').trim();
};
