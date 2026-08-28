import { normalizeAdmissionNumber } from './hostelRequestListDto.js';

/** Normalize admission / roll for identity grouping in student lists. */
export const normalizeStudentIdentityKey = (student) => {
  const admission = normalizeAdmissionNumber(student?.admissionNumber);
  const roll = (student?.rollNumber || '').toString().trim().toUpperCase();
  return admission || roll || null;
};

const academicYearStart = (ay) => {
  if (!ay || typeof ay !== 'string') return 0;
  const year = parseInt(ay.split('-')[0], 10);
  return Number.isFinite(year) ? year : 0;
};

/** Higher score = preferred canonical row when duplicates share an identity. */
export const scoreCanonicalStudent = (student, { linkedUserId } = {}) => {
  let score = academicYearStart(student?.currentAcademicYear || student?.academicYear) * 1000;

  if (linkedUserId && String(student?._id) === String(linkedUserId)) {
    score += 500;
  }
  if (student?.hostelRequestId) score += 100;
  if (student?.enrollmentHistoryStatus) score += 50;
  if (student?.isHistoricalView) score += 10;
  if (['Active', 'Extended'].includes(student?.applicationStatus)) score += 5;

  const created = student?.hostelRequestCreatedAt || student?.createdAt;
  if (created) {
    score += new Date(created).getTime() / 1e15;
  }

  return score;
};

/**
 * Collapse duplicate list rows that share admission number or roll (stale + renewed User docs).
 * Keeps the renewed / HostelRequest-backed record.
 */
export const dedupeStudentsByIdentity = (students, options = {}) => {
  if (!Array.isArray(students) || students.length <= 1) {
    return students || [];
  }

  const byKey = new Map();
  const withoutKey = [];

  for (const student of students) {
    const key = normalizeStudentIdentityKey(student);
    if (!key) {
      withoutKey.push(student);
      continue;
    }

    const existing = byKey.get(key);
    const studentScore = scoreCanonicalStudent(student, options);
    const existingScore = existing ? scoreCanonicalStudent(existing, options) : -Infinity;

    if (!existing || studentScore > existingScore) {
      byKey.set(key, student);
    }
  }

  return [...byKey.values(), ...withoutKey];
};

/**
 * Pick the canonical User among duplicates sharing an admission number.
 * Used by maintenance scripts.
 */
export const pickCanonicalUser = (users, { linkedUserId } = {}) => {
  if (!users?.length) return null;
  if (users.length === 1) return users[0];

  return [...users].sort(
    (a, b) => scoreCanonicalStudent(b, { linkedUserId }) - scoreCanonicalStudent(a, { linkedUserId })
  )[0];
};
