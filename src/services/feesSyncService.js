import { connectFeesDatabase, getFeesConnection, isFeesDbConfigured } from '../config/feesDatabase.js';
import { getStudentFeeModel } from '../models/fees/StudentFee.js';
import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';

const HOSTEL_FEE_HEAD_CODE = 'HST01';
const HOSTEL_FEE_HEAD_NAME = 'Hostel Fee';
const CAUTION_FEE_HEAD_CODE = 'CDT01';
const CAUTION_FEE_HEAD_NAME = 'Caution Deposit';
const FEE_HEADS_COLLECTION = 'feeheads';

let cachedHostelFeeHeadId = null;
let cachedCautionFeeHeadId = null;

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

export const resolveCautionFeeHeadId = async () => {
  if (cachedCautionFeeHeadId) return cachedCautionFeeHeadId;

  const ready = await ensureFeesReady();
  if (!ready) {
    throw new Error('Fees database is not configured or not connected');
  }

  const db = getFeesConnection().db;
  const feeHeads = db.collection(FEE_HEADS_COLLECTION);
  const byCode = await feeHeads.findOne({ code: CAUTION_FEE_HEAD_CODE });
  if (byCode?._id) {
    cachedCautionFeeHeadId = byCode._id;
    return cachedCautionFeeHeadId;
  }

  const byName = await feeHeads.findOne({ name: CAUTION_FEE_HEAD_NAME });
  if (byName?._id) {
    cachedCautionFeeHeadId = byName._id;
    return cachedCautionFeeHeadId;
  }

  throw new Error(
    `Caution Deposit Fee head (${CAUTION_FEE_HEAD_CODE}) not found in Fees database collection "${FEE_HEADS_COLLECTION}"`
  );
};

export const isFirstHostelYear = (student, currentSyncYear) => {
  if (!student) return false;
  
  let startingYear = student.academicYear;
  if (student.renewalHistory && student.renewalHistory.length > 0) {
    const sorted = [...student.renewalHistory].sort((a, b) => new Date(a.renewedAt) - new Date(b.renewedAt));
    startingYear = sorted[0].previousAcademicYear;
  } else if (student.totalRenewals > 0) {
    return false;
  }
  
  const norm = (ay) => (ay || '').toString().trim();
  return norm(startingYear) === norm(currentSyncYear);
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

const buildStudentFeePayload = (student, enriched, feeHeadId, academicYear, customAmount) => {
  const feesAcademicYear = toFeesAcademicYear(academicYear);
  const studentId = resolveFeesStudentId(student, enriched);
  const concession = Number(enriched.concession ?? student.concession ?? 0);
  const finalAmount = customAmount !== undefined ? customAmount : Number(enriched.totalCalculatedFee ?? student.totalCalculatedFee ?? 0);

  return {
    academicYear: feesAcademicYear,
    feeHead: feeHeadId,
    semester: null,
    studentId,
    studentYear: Number(enriched.year ?? student.year ?? 1),
    amount: finalAmount,
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

  // 1. Check if student has a revised fee in overall_concessions in SQL
  let finalTotalFee = Number(plain.totalCalculatedFee ?? 0);
  let finalTerm1Fee = Number(plain.calculatedTerm1Fee ?? 0);
  let finalTerm2Fee = Number(plain.calculatedTerm2Fee ?? 0);
  let finalTerm3Fee = Number(plain.calculatedTerm3Fee ?? 0);
  let wasRevised = false;

  try {
    const { fetchConcessionsForStudent } = await import('../utils/sqlService.js');
    const roll = plain.rollNumber;
    const concessionsResult = await fetchConcessionsForStudent(roll);
    if (concessionsResult.success && concessionsResult.data) {
      const concessions = concessionsResult.data;
      let revisedFees = concessions.revised_fees;
      if (typeof revisedFees === 'string') {
        try {
          revisedFees = JSON.parse(revisedFees);
        } catch (err) {
          console.error('Failed to parse revised_fees JSON:', err);
        }
      }
      if (Array.isArray(revisedFees)) {
        const studentYear = Number(enriched.year ?? plain.year ?? 1);
        const hostelRevisedFee = revisedFees.find(
          f => f.feeHeadCode === 'HST01' && Number(f.studentYear) === Number(studentYear)
        );
        if (hostelRevisedFee && hostelRevisedFee.revisedAmount !== undefined && hostelRevisedFee.revisedAmount !== null) {
          const revisedAmount = Number(hostelRevisedFee.revisedAmount);
          let finalRevisedAmount = revisedAmount;

          if (hostelRevisedFee.concessionType === 'CONCESSION') {
            try {
              const FeeStructure = (await import('../models/FeeStructure.js')).default;
              const feeCourse = enriched.course || plain.course;
              const feeBranch = enriched.branch || plain.branch;
              const feeYear = studentYear;
              const feeCategory = plain.category;
              if (academicYear && feeCourse && feeCategory) {
                const feeStructure = await FeeStructure.getFeeStructure(
                  academicYear,
                  feeCourse,
                  feeBranch,
                  feeYear,
                  feeCategory
                );
                if (feeStructure) {
                  const originalFee = feeStructure.totalFee || 0;
                  finalRevisedAmount = Math.max(0, originalFee - revisedAmount);
                  console.log(`💰 [syncStudentHostelFee] Applying CONCESSION: Original: ₹${originalFee}, Concession: ₹${revisedAmount}, Final revised: ₹${finalRevisedAmount}`);
                } else {
                  console.warn(`⚠️ [syncStudentHostelFee] CONCESSION requested but no fee structure found for ${feeCourse}/${feeBranch}/year ${feeYear}/category ${feeCategory}`);
                }
              }
            } catch (feeError) {
              console.error('❌ Error retrieving fee structure for concession during sync:', feeError);
            }
          }

          finalTotalFee = finalRevisedAmount;
          finalTerm1Fee = Math.round(finalRevisedAmount * 0.4);
          finalTerm2Fee = Math.round(finalRevisedAmount * 0.3);
          finalTerm3Fee = Math.round(finalRevisedAmount * 0.3);
          wasRevised = true;
          console.log(`💰 [syncStudentHostelFee] Found revised/concession fee for student ${roll}: ₹${finalRevisedAmount}`);
        }
      }
    }
  } catch (concessionError) {
    console.error('❌ Error checking overall concessions during sync:', concessionError);
  }

  // If a revised fee was found and it differs from the saved one, update MongoDB User record
  if (wasRevised && finalTotalFee !== Number(plain.totalCalculatedFee ?? 0)) {
    try {
      const User = (await import('../models/User.js')).default;
      await User.updateOne(
        { _id: plain._id },
        {
          $set: {
            totalCalculatedFee: finalTotalFee,
            calculatedTerm1Fee: finalTerm1Fee,
            calculatedTerm2Fee: finalTerm2Fee,
            calculatedTerm3Fee: finalTerm3Fee
          }
        }
      );
      console.log(`🔄 [syncStudentHostelFee] Updated MongoDB User ${plain.rollNumber} with revised fee: ₹${finalTotalFee}`);
    } catch (saveError) {
      console.error('❌ Failed to update revised fee in MongoDB User:', saveError);
    }
  }

  const feeHeadId = await resolveHostelFeeHeadId();
  const payload = buildStudentFeePayload(plain, enriched, feeHeadId, academicYear, finalTotalFee);

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

  // --- Caution Deposit Sync (New Feature) ---
  try {
    const isFirstYear = isFirstHostelYear(plain, academicYear);
    if (isFirstYear) {
      const cautionFeeHeadId = await resolveCautionFeeHeadId();
      
      // Determine caution deposit amount
      let cautionAmount = 0;
      const FeeStructure = (await import('../models/FeeStructure.js')).default;
      
      // 1. Try new format query first (using hostelId and categoryId)
      if (plain.hostel && plain.hostelCategory) {
        const newFormatQuery = {
          academicYear,
          course: enriched.course || plain.course,
          year: Number(enriched.year ?? plain.year ?? 1),
          isActive: true,
          hostelId: plain.hostel,
          categoryId: plain.hostelCategory,
          feeType: { $in: ['caution_deposit', 'cautionDeposit'] }
        };
        const branchVal = enriched.branch || plain.branch;
        if (branchVal) {
          newFormatQuery.$or = [
            { branch: branchVal },
            { branch: null },
            { branch: { $exists: false } }
          ];
        }
        
        const fs = await FeeStructure.findOne(newFormatQuery);
        if (fs) {
          cautionAmount = fs.amount;
        }
      }
      
      // 2. Try legacy/additionalFees fallback if amount is still 0
      if (cautionAmount === 0) {
        const additionalFees = await FeeStructure.getAdditionalFees(academicYear, plain.category);
        const feeData = additionalFees.cautionDeposit || additionalFees.caution_deposit;
        if (feeData && feeData.isActive) {
          if (feeData.categoryAmounts && feeData.categoryAmounts[plain.category] !== undefined) {
            cautionAmount = feeData.categoryAmounts[plain.category];
          } else {
            cautionAmount = feeData.amount;
          }
        }
      }
      
      if (cautionAmount > 0) {
        const cautionPayload = buildStudentFeePayload(plain, enriched, cautionFeeHeadId, academicYear, cautionAmount);
        if (cautionPayload.studentId && cautionPayload.academicYear) {
          const StudentFeeModel = getStudentFeeModel();
          
          // Clean legacy short year if exists
          const cautionLegacyShortYear = cautionPayload.academicYear.includes('-')
            ? cautionPayload.academicYear.split('-')[0]
            : null;
          if (cautionLegacyShortYear) {
            await StudentFeeModel.deleteOne({
              studentId: cautionPayload.studentId,
              feeHead: cautionFeeHeadId,
              academicYear: cautionLegacyShortYear
            });
          }
          
          await StudentFeeModel.findOneAndUpdate(
            {
              studentId: cautionPayload.studentId,
              feeHead: cautionFeeHeadId,
              academicYear: cautionPayload.academicYear
            },
            {
              $set: cautionPayload,
              $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true, new: true, runValidators: false }
          );
          console.log(`💰 [syncStudentHostelFee] Automatically synced Caution Deposit: ₹${cautionAmount} for student ${plain.rollNumber}`);
        }
      } else {
        console.log(`ℹ️ [syncStudentHostelFee] Caution Deposit amount is 0 or not configured for student ${plain.rollNumber} — skipping caution deposit sync`);
      }
    } else {
      console.log(`ℹ️ [syncStudentHostelFee] Student ${plain.rollNumber} is renewed/not in their first year of study for academic year ${academicYear} — skipping caution deposit sync`);
    }
  } catch (cautionError) {
    console.warn(`⚠️ [syncStudentHostelFee] Caution Deposit sync skipped/failed: ${cautionError.message}`);
  }

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
  let cautionFeeHeadId = null;
  try {
    feeHeadId = await resolveHostelFeeHeadId();
  } catch (error) {
    console.warn('Fees sync: hostel fee head not found during delete');
  }
  try {
    cautionFeeHeadId = await resolveCautionFeeHeadId();
  } catch (error) {
    console.warn('Fees sync: caution fee head not found during delete');
  }

  const StudentFee = getStudentFeeModel();
  let deletedCount = 0;

  if (feeHeadId) {
    const filter = { studentId, academicYear: feesAcademicYear, feeHead: feeHeadId };
    const res = await StudentFee.deleteMany(filter);
    deletedCount += res.deletedCount;

    const legacyShortYear = feesAcademicYear.includes('-')
      ? feesAcademicYear.split('-')[0]
      : null;
    if (legacyShortYear && legacyShortYear !== feesAcademicYear) {
      const legacyFilter = { studentId, academicYear: legacyShortYear, feeHead: feeHeadId };
      const legacyResult = await StudentFee.deleteMany(legacyFilter);
      deletedCount += legacyResult.deletedCount;
    }
  }

  if (cautionFeeHeadId) {
    const filter = { studentId, academicYear: feesAcademicYear, feeHead: cautionFeeHeadId };
    const res = await StudentFee.deleteMany(filter);
    deletedCount += res.deletedCount;

    const legacyShortYear = feesAcademicYear.includes('-')
      ? feesAcademicYear.split('-')[0]
      : null;
    if (legacyShortYear && legacyShortYear !== feesAcademicYear) {
      const legacyFilter = { studentId, academicYear: legacyShortYear, feeHead: cautionFeeHeadId };
      const legacyResult = await StudentFee.deleteMany(legacyFilter);
      deletedCount += legacyResult.deletedCount;
    }
  }

  return { ok: true, deletedCount };
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
  let cautionFeeHeadId = null;
  try {
    feeHeadId = await resolveHostelFeeHeadId();
  } catch (error) {
    console.warn('Fees sync: hostel fee head not found during delete-all');
  }
  try {
    cautionFeeHeadId = await resolveCautionFeeHeadId();
  } catch (error) {
    console.warn('Fees sync: caution fee head not found during delete-all');
  }

  const StudentFee = getStudentFeeModel();
  let deletedCount = 0;

  if (feeHeadId) {
    const res = await StudentFee.deleteMany({ studentId, feeHead: feeHeadId });
    deletedCount += res.deletedCount;
  }
  if (cautionFeeHeadId) {
    const res = await StudentFee.deleteMany({ studentId, feeHead: cautionFeeHeadId });
    deletedCount += res.deletedCount;
  }

  return { ok: true, deletedCount };
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
