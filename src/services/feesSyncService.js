import { connectFeesDatabase, getFeesConnection, isFeesDbConfigured } from '../config/feesDatabase.js';
import { getStudentFeeModel } from '../models/fees/StudentFee.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';

const HOSTEL_FEE_HEAD_CODE = 'HST01';
const HOSTEL_FEE_HEAD_NAME = 'Hostel Fee';
const FEE_HEADS_COLLECTION = 'feeheads';

let cachedHostelFeeHeadId = null;

export const toFeesAcademicYear = (academicYear) => {
  if (!academicYear) return null;
  const value = String(academicYear).trim();
  if (/^\d{4}-\d{4}$/.test(value)) return value;
  if (/^\d{4}$/.test(value)) {
    const start = parseInt(value, 10);
    return `${start}-${start + 1}`;
  }
  return value;
};

const resolveCollegeName = (student) => {
  const college = student?.college;
  if (!college) return '';
  if (typeof college === 'string') {
    try {
      const parsed = JSON.parse(college);
      return parsed?.name || parsed?.collegeName || college;
    } catch {
      return college;
    }
  }
  return college.name || college.collegeName || '';
};

const ensureFeesReady = async () => {
  if (!isFeesDbConfigured()) return false;
  await connectFeesDatabase();
  return Boolean(getFeesConnection());
};

export const resolveHostelFeeHeadId = async () => {
  if (cachedHostelFeeHeadId) return cachedHostelFeeHeadId;

  const ready = await ensureFeesReady();
  if (!ready) {
    throw new Error('Fees database is not configured or not connected');
  }

  const db = getFeesConnection().db;
  const feeHeads = db.collection(FEE_HEADS_COLLECTION);
  const byCode = await feeHeads.findOne({ code: HOSTEL_FEE_HEAD_CODE });
  if (byCode?._id) {
    cachedHostelFeeHeadId = byCode._id;
    return cachedHostelFeeHeadId;
  }

  const byName = await feeHeads.findOne({ name: HOSTEL_FEE_HEAD_NAME });
  if (byName?._id) {
    cachedHostelFeeHeadId = byName._id;
    return cachedHostelFeeHeadId;
  }

  throw new Error(
    `Hostel Fee head (${HOSTEL_FEE_HEAD_CODE}) not found in Fees database collection "${FEE_HEADS_COLLECTION}"`
  );
};

/** Fees DB uses admission number as studentId (e.g. "20230353"), not PIN/roll. */
export const resolveFeesStudentId = (student, enriched = {}) => {
  const admission =
    enriched.admissionNumber ||
    student?.admissionNumber ||
    enriched.admission_number ||
    student?.admission_number;
  return String(admission || '').trim();
};

const buildStudentFeePayload = (student, enriched, feeHeadId, academicYear) => {
  const feesAcademicYear = toFeesAcademicYear(academicYear);
  const studentId = resolveFeesStudentId(student, enriched);
  const concession = Number(enriched.concession ?? student.concession ?? 0);

  return {
    academicYear: feesAcademicYear,
    feeHead: feeHeadId,
    semester: null,
    studentId,
    studentYear: Number(enriched.year ?? student.year ?? 1),
    amount: Number(enriched.totalCalculatedFee ?? student.totalCalculatedFee ?? 0),
    branch: String(enriched.branch || student.branch || '').trim(),
    college: resolveCollegeName(enriched) || resolveCollegeName(student),
    course: String(enriched.course || student.course || '').trim(),
    isScholarshipApplicable: concession > 0,
    stud_type: String(enriched.studType || enriched.stud_type || 'CONV').trim() || 'CONV',
    studentName: String(enriched.name || student.name || '').trim(),
    updatedAt: new Date()
  };
};

/**
 * Upsert hostel fee row in Fees DB studentfees collection.
 */
export const syncStudentHostelFee = async (studentDoc, options = {}) => {
  if (!(await ensureFeesReady())) {
    return { skipped: true, reason: 'fees_db_not_configured' };
  }

  const plain = studentDoc?.toObject ? studentDoc.toObject() : { ...studentDoc };
  const academicYear = options.academicYear || plain.academicYear;
  if (!academicYear) {
    return { skipped: true, reason: 'missing_academic_year' };
  }

  const enriched = await enrichStudentAcademics(plain);
  const feeHeadId = await resolveHostelFeeHeadId();
  const payload = buildStudentFeePayload(plain, enriched, feeHeadId, academicYear);

  if (!payload.studentId || !payload.academicYear) {
    return {
      skipped: true,
      reason: 'missing_admission_number',
      rollNumber: plain.rollNumber
    };
  }

  const StudentFee = getStudentFeeModel();

  const legacyShortYear = payload.academicYear.includes('-')
    ? payload.academicYear.split('-')[0]
    : null;
  if (legacyShortYear) {
    await StudentFee.deleteOne({
      studentId: payload.studentId,
      feeHead: feeHeadId,
      academicYear: legacyShortYear
    });
  }

  const result = await StudentFee.findOneAndUpdate(
    {
      studentId: payload.studentId,
      feeHead: feeHeadId,
      academicYear: payload.academicYear
    },
    {
      $set: payload,
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, new: true, runValidators: false }
  );

  return { ok: true, id: result._id, studentId: payload.studentId };
};

export const deleteStudentHostelFeesForAcademicYear = async (admissionNumber, academicYear) => {
  if (!(await ensureFeesReady())) {
    return { skipped: true, reason: 'fees_db_not_configured' };
  }

  const studentId = String(admissionNumber || '').trim();
  const feesAcademicYear = toFeesAcademicYear(academicYear);
  if (!studentId || !feesAcademicYear) {
    return { skipped: true, reason: 'missing_admission_or_academic_year' };
  }

  let feeHeadId = null;
  try {
    feeHeadId = await resolveHostelFeeHeadId();
  } catch (error) {
    console.warn('Fees sync: hostel fee head not found during delete — removing by student/year only');
  }

  const filter = { studentId, academicYear: feesAcademicYear };
  if (feeHeadId) filter.feeHead = feeHeadId;

  const StudentFee = getStudentFeeModel();
  let result = await StudentFee.deleteMany(filter);

  const legacyShortYear = feesAcademicYear.includes('-')
    ? feesAcademicYear.split('-')[0]
    : null;
  if (legacyShortYear && legacyShortYear !== feesAcademicYear) {
    const legacyFilter = { studentId, academicYear: legacyShortYear };
    if (feeHeadId) legacyFilter.feeHead = feeHeadId;
    const legacyResult = await StudentFee.deleteMany(legacyFilter);
    result = { deletedCount: result.deletedCount + legacyResult.deletedCount };
  }

  return { ok: true, deletedCount: result.deletedCount };
};

export const deleteAllStudentHostelFees = async (admissionNumber) => {
  if (!(await ensureFeesReady())) {
    return { skipped: true, reason: 'fees_db_not_configured' };
  }

  const studentId = String(admissionNumber || '').trim();
  if (!studentId) {
    return { skipped: true, reason: 'missing_admission_number' };
  }

  let feeHeadId = null;
  try {
    feeHeadId = await resolveHostelFeeHeadId();
  } catch (error) {
    console.warn('Fees sync: hostel fee head not found during delete-all — skipping');
    return { skipped: true, reason: 'hostel_fee_head_not_found' };
  }

  const StudentFee = getStudentFeeModel();
  const result = await StudentFee.deleteMany({ studentId, feeHead: feeHeadId });
  return { ok: true, deletedCount: result.deletedCount };
};

export const syncStudentHostelFeeSafely = async (studentDoc, options = {}) => {
  try {
    const result = await syncStudentHostelFee(studentDoc, options);
    if (result.skipped && result.reason === 'missing_admission_number') {
      console.warn(
        `⚠️ Fees DB sync skipped for ${result.rollNumber || 'unknown'}: admission number not found`
      );
    } else if (result.ok) {
      const roll = studentDoc?.rollNumber || 'n/a';
      console.log(`✅ Fees DB synced — studentId ${result.studentId} (roll ${roll})`);
    }
    return result;
  } catch (error) {
    const roll = studentDoc?.rollNumber || 'unknown';
    console.error(`❌ Fees DB sync failed for ${roll}:`, error.message);
    return { ok: false, error: error.message };
  }
};

export const deleteStudentHostelFeesForAcademicYearSafely = async (admissionNumber, academicYear) => {
  try {
    const result = await deleteStudentHostelFeesForAcademicYear(admissionNumber, academicYear);
    if (result.ok && result.deletedCount > 0) {
      console.log(
        `✅ Fees DB deleted — studentId ${admissionNumber}, academicYear ${toFeesAcademicYear(academicYear)} (${result.deletedCount} hostel fee row(s))`
      );
    }
    return result;
  } catch (error) {
    console.error(
      `❌ Fees DB delete failed for ${admissionNumber} (${academicYear}):`,
      error.message
    );
    return { ok: false, error: error.message };
  }
};

export const deleteAllStudentHostelFeesSafely = async (admissionNumber) => {
  try {
    return await deleteAllStudentHostelFees(admissionNumber);
  } catch (error) {
    console.error(`❌ Fees DB delete-all failed for ${admissionNumber}:`, error.message);
    return { ok: false, error: error.message };
  }
};
