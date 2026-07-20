import { fetchStudentByIdentifier, fetchStudentsByIdentifiers, fetchConcessionsForStudent, fetchConcessionsForStudents } from './sqlService.js';
import { matchCourseAndBranch } from './courseBranchMatcher.js';
import { normalizeBatchToYear } from './batchUtils.js';
import { formatSqlStudentPhoto, resolveStudentPhotoDisplay } from './studentPhotoService.js';

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes cache TTL
const FAIL_CACHE_TTL_MS = 60 * 1000;
const BATCH_CHUNK_SIZE = 100; // Fetch 100 students per query
const MAX_CONCURRENT_BATCHES = 8; // Run up to 8 parallel central DB requests

const academicsCache = new Map();
const inFlight = new Map();

const normalizeKey = (value) => (value || '').toString().trim().toUpperCase();

const toPlainStudent = (student) => {
  if (!student) return null;
  if (typeof student.toObject === 'function') return student.toObject();
  return { ...student };
};

const getCachedEntry = (key) => {
  const cached = academicsCache.get(key);
  if (!cached) return null;
  const ttl = cached.failed ? FAIL_CACHE_TTL_MS : CACHE_TTL_MS;
  if (Date.now() - cached.ts >= ttl) {
    academicsCache.delete(key);
    return null;
  }
  return cached;
};

const cacheSqlRowKeys = async (sqlRow) => {
  const data = await parseSqlStudentRow(sqlRow);
  const keys = new Set(
    [sqlRow.pin_no, sqlRow.admission_number, sqlRow.admission_no]
      .map(normalizeKey)
      .filter(Boolean)
  );
  const entry = { ts: Date.now(), data, failed: false };
  keys.forEach((key) => academicsCache.set(key, entry));
  return data;
};

const cacheFailure = (keys) => {
  const entry = { ts: Date.now(), data: null, failed: true };
  keys.forEach((key) => academicsCache.set(key, entry));
};

const mapGender = (sqlGender) => {
  if (sqlGender == null || sqlGender === '') return null;
  const normalized = sqlGender.toString().trim().toUpperCase();
  if (['M', 'MALE', 'BOY', 'BOYS', '1'].includes(normalized)) return 'Male';
  if (['F', 'FEMALE', 'GIRL', 'GIRLS', '2'].includes(normalized)) return 'Female';
  return null;
};

const sanitizePhoneNumber = (phone) => {
  if (phone == null || phone === '') return '';
  // Remove all non-digit characters
  const digits = phone.toString().replace(/\D/g, '');
  // If it's a 10-digit number, return it. If it has a country code prefix (e.g. 91) and is 12 digits, return the last 10 digits.
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits; // Return whatever digits we found if it's shorter
};

const phonesDiffer = (sqlPhone, mongoPhone) => {
  const sql = sanitizePhoneNumber(sqlPhone);
  if (!sql) return false; // Don't clear Mongo when SQL is empty
  return sql !== sanitizePhoneNumber(mongoPhone);
};

/**
 * Map a raw SQL students row to normalized academic fields.
 */
export const parseSqlStudentRow = async (sqlRow) => {
  if (!sqlRow) return null;

  let course = sqlRow.course || '';
  let branch = sqlRow.branch || '';
  let courseId = null;
  let branchId = null;
  let sqlCourseId = null;
  let sqlBranchId = null;
  let college = null;

  if (course) {
    const match = await matchCourseAndBranch(course, branch);
    if (match.success) {
      course = match.courseName || course;
      branch = match.branchName || branch;
      courseId = match.courseId;
      branchId = match.branchId;
      college = match.college;
      if (courseId?.toString().startsWith('sql_')) {
        sqlCourseId = parseInt(courseId.toString().replace('sql_', ''), 10);
      }
      if (branchId?.toString().startsWith('sql_')) {
        sqlBranchId = parseInt(branchId.toString().replace('sql_', ''), 10);
      }
    }
  }

  const studentPhoto = formatSqlStudentPhoto(sqlRow.student_photo);

  return {
    name: sqlRow.student_name || null,
    gender: mapGender(sqlRow.gender),
    fatherName: sqlRow.father_name || null,
    dob: sqlRow.dob || null,
    adharNo: sqlRow.adhar_no || null,
    address: sqlRow.student_address || null,
    college: college || null,
    rollNumber: (sqlRow.pin_no || '').toString().trim().toUpperCase() || null,
    pin_no: (sqlRow.pin_no || '').toString().trim().toUpperCase() || null,
    admissionNumber:
      (sqlRow.admission_number || sqlRow.admission_no || '').toString().trim() || null,
    course,
    branch,
    year: sqlRow.current_year ? parseInt(sqlRow.current_year, 10) : 1,
    batch: normalizeBatchToYear(sqlRow.batch),
    courseId,
    branchId,
    sqlCourseId,
    sqlBranchId,
    studentPhone: sanitizePhoneNumber(sqlRow.student_mobile),
    parentPhone: sanitizePhoneNumber(sqlRow.preferred_mobile_number || sqlRow.parent_mobile1),
    motherPhone: sanitizePhoneNumber(sqlRow.parent_mobile2),
    studType: (sqlRow.stud_type || '').toString().trim() || null,
    stud_type: (sqlRow.stud_type || '').toString().trim() || null,
    studentPhoto,
    academicSource: 'sql'
  };
};

const loadIdentifiersBatch = async (identifiers) => {
  const keys = [...new Set(identifiers.map(normalizeKey).filter(Boolean))];
  const pending = keys.filter((key) => !getCachedEntry(key) && !inFlight.has(key));
  if (pending.length === 0) return;

  const chunks = [];
  for (let i = 0; i < pending.length; i += BATCH_CHUNK_SIZE) {
    chunks.push(pending.slice(i, i + BATCH_CHUNK_SIZE));
  }

  let batchIndex = 0;
  const worker = async () => {
    while (batchIndex < chunks.length) {
      const chunk = chunks[batchIndex++];
      const chunkPromise = (async () => {
        const result = await fetchStudentsByIdentifiers(chunk);
        if (!result.success) {
          cacheFailure(chunk);
          return;
        }

        const matchedKeys = new Set();
        await Promise.all(
          (result.data || []).map(async (row) => {
            const rowKeys = [row.pin_no, row.admission_number, row.admission_no]
              .map(normalizeKey)
              .filter(Boolean);
            rowKeys.forEach((k) => matchedKeys.add(k));
            await cacheSqlRowKeys(row);
          })
        );

        chunk
          .filter((key) => !matchedKeys.has(key))
          .forEach((key) => cacheFailure([key]));
      })();

      chunk.forEach((key) => inFlight.set(key, chunkPromise));
      try {
        await chunkPromise;
      } finally {
        chunk.forEach((key) => inFlight.delete(key));
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_BATCHES, chunks.length) }, () => worker())
  );
};

/**
 * Load academics from SQL by PIN / admission number (cached, deduped).
 */
export const loadAcademicsFromSQL = async (identifier) => {
  const key = normalizeKey(identifier);
  if (!key) return null;

  const cached = getCachedEntry(key);
  if (cached) return cached.failed ? null : cached.data;

  if (inFlight.has(key)) {
    await inFlight.get(key);
    const after = getCachedEntry(key);
    return after?.failed ? null : after?.data ?? null;
  }

  const promise = (async () => {
    await loadIdentifiersBatch([key]);
    const entry = getCachedEntry(key);
    return entry?.failed ? null : entry?.data ?? null;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
};

/**
 * Overlay SQL academics and contact phones onto a student document for API responses.
 */
/**
 * Restore roll number on legacy/corrupt records (e.g. null rollNumber in MongoDB).
 */
export const repairMissingRollNumber = async (student, academicSnapshot = null) => {
  if (student.rollNumber?.trim()) return false;

  const snapshot = academicSnapshot || (await enrichStudentAcademics(student));
  const resolved = (
    snapshot?.pin_no ||
    snapshot?.rollNumber ||
    student.admissionNumber ||
    ''
  )
    .toString()
    .trim()
    .toUpperCase();

  if (resolved) {
    student.rollNumber = resolved;
    return true;
  }
  return false;
};

export const enrichStudentAcademics = async (student, preFetchedConcession = undefined, options = {}) => {
  const plain = toPlainStudent(student);
  if (!plain) return plain;

  // Prefer roll/PIN, but always fall back to admission number.
  // Some SDMS records have null pin_no and are only findable by admission_number.
  const identifiers = [...new Set(
    [plain.rollNumber, plain.admissionNumber]
      .map(normalizeKey)
      .filter(Boolean)
  )];

  let sqlAcademics = null;
  for (const identifier of identifiers) {
    sqlAcademics = await loadAcademicsFromSQL(identifier);
    if (sqlAcademics) break;
  }

  let enriched = {
    ...plain,
    ...(sqlAcademics || {}),
    academicSource: sqlAcademics ? 'sql' : (plain.course ? 'mongo' : 'unknown')
  };

  // Don't let a null SQL pin overwrite an existing Mongo roll number
  if (sqlAcademics && !sqlAcademics.rollNumber && plain.rollNumber) {
    enriched.rollNumber = plain.rollNumber;
  }
  if (sqlAcademics && !sqlAcademics.admissionNumber && plain.admissionNumber) {
    enriched.admissionNumber = plain.admissionNumber;
  }

  if (sqlAcademics) {
    const studentPhoto = resolveStudentPhotoDisplay(sqlAcademics.studentPhoto, plain.studentPhoto);
    enriched.studentPhoto = studentPhoto;
    enriched.photoSource = sqlAcademics.studentPhoto ? 'sdms' : (plain.studentPhoto ? 'mongo' : null);

    // Check if any key fields differ from plain (MongoDB) data and prepare updates
    const updates = {};
    
    if (sqlAcademics.name && sqlAcademics.name !== plain.name) {
      updates.name = sqlAcademics.name;
    }
    if (sqlAcademics.gender && sqlAcademics.gender !== plain.gender) {
      updates.gender = sqlAcademics.gender;
    }
    if (phonesDiffer(sqlAcademics.studentPhone, plain.studentPhone)) {
      updates.studentPhone = sanitizePhoneNumber(sqlAcademics.studentPhone);
    }
    if (phonesDiffer(sqlAcademics.parentPhone, plain.parentPhone)) {
      updates.parentPhone = sanitizePhoneNumber(sqlAcademics.parentPhone);
    }
    if (phonesDiffer(sqlAcademics.motherPhone, plain.motherPhone)) {
      updates.motherPhone = sanitizePhoneNumber(sqlAcademics.motherPhone);
    }
    if (sqlAcademics.dob && sqlAcademics.dob !== plain.dob) {
      updates.dob = sqlAcademics.dob;
    }
    if (sqlAcademics.adharNo && sqlAcademics.adharNo !== plain.adharNo) {
      updates.adharNo = sqlAcademics.adharNo;
    }
    if (sqlAcademics.address && sqlAcademics.address !== plain.address) {
      updates.address = sqlAcademics.address;
    }
    if (sqlAcademics.fatherName && sqlAcademics.fatherName !== plain.fatherName) {
      updates.fatherName = sqlAcademics.fatherName;
    }
    
    // Compare college details
    if (sqlAcademics.college) {
      const col = sqlAcademics.college;
      const plainCol = plain.college || {};
      if (col.id !== plainCol.id || col.name !== plainCol.name || col.code !== plainCol.code) {
        updates.college = col;
      }
    }
    
    // Compare course/branch/year/batch details
    if (sqlAcademics.course && sqlAcademics.course !== plain.course) {
      updates.course = sqlAcademics.course;
    }
    if (sqlAcademics.branch && sqlAcademics.branch !== plain.branch) {
      updates.branch = sqlAcademics.branch;
    }
    if (sqlAcademics.year && Number(sqlAcademics.year) !== Number(plain.year)) {
      updates.year = sqlAcademics.year;
    }
    if (sqlAcademics.batch && sqlAcademics.batch !== plain.batch) {
      updates.batch = sqlAcademics.batch;
    }
    
    // Write changes to MongoDB if there are any discrepancies
    if (Object.keys(updates).length > 0) {
      try {
        const User = (await import('../models/User.js')).default;
        await User.updateOne({ _id: plain._id }, { $set: updates });
        console.log(`🔄 [enrichStudentAcademics] Automatically updated MongoDB User ${plain.rollNumber || plain.admissionNumber} with latest SQL database details:`, updates);
        
        // Keep in-memory enriched values synchronized
        Object.assign(enriched, updates);
      } catch (dbErr) {
        console.error('❌ Error updating student database discrepancies in MongoDB:', dbErr);
      }
    }
  }

  const skipFeesAndConcessions = options.skipFeesAndConcessions || false;
  const identifier = identifiers[0] || null;

  // Live Concessions Sync
  if (identifier && !skipFeesAndConcessions) {
    let concessionRow = preFetchedConcession;

    if (concessionRow === undefined) {
      try {
        const concessionsResult = await fetchConcessionsForStudent(identifier);
        if (concessionsResult.success) {
          concessionRow = concessionsResult.data;
        }
      } catch (err) {
        console.error('❌ Error fetching single concessions during enrichment:', err);
      }
    }

    if (concessionRow) {
      let revisedFees = concessionRow.revised_fees;
      if (typeof revisedFees === 'string') {
        try {
          revisedFees = JSON.parse(revisedFees);
        } catch (err) {
          console.error('Failed to parse revised_fees JSON:', err);
        }
      }

      if (Array.isArray(revisedFees)) {
        const yearOfStudy = Number(enriched.year ?? plain.year ?? 1);
        const hostelRevisedFee = revisedFees.find(
          f => f.feeHeadCode === 'HST01' && Number(f.studentYear) === Number(yearOfStudy)
        );

        if (hostelRevisedFee && hostelRevisedFee.revisedAmount !== undefined && hostelRevisedFee.revisedAmount !== null) {
          const revisedAmount = Number(hostelRevisedFee.revisedAmount);
          let finalRevisedAmount = revisedAmount;

          if (hostelRevisedFee.concessionType === 'CONCESSION') {
            try {
              const FeeStructure = (await import('../models/FeeStructure.js')).default;
              const feeCourse = enriched.course || plain.course;
              const feeBranch = enriched.branch || plain.branch;
              const feeYear = yearOfStudy;
              const feeCategory = plain.category;
              const academicYear = enriched.academicYear || plain.academicYear;
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
                  console.log(`💰 [enrichStudentAcademics] Applying CONCESSION: Original: ₹${originalFee}, Concession: ₹${revisedAmount}, Final revised: ₹${finalRevisedAmount}`);
                } else {
                  console.warn(`⚠️ [enrichStudentAcademics] CONCESSION requested but no fee structure found for ${feeCourse}/${feeBranch}/year ${feeYear}/category ${feeCategory}`);
                }
              }
            } catch (feeError) {
              console.error('❌ Error retrieving fee structure for concession during enrichment:', feeError);
            }
          }

          const currentSavedFee = Number(plain.totalCalculatedFee ?? 0);

          // Check if different from MongoDB
          if (finalRevisedAmount !== currentSavedFee) {
            const term1 = Math.round(finalRevisedAmount * 0.4);
            const term2 = Math.round(finalRevisedAmount * 0.3);
            const term3 = Math.round(finalRevisedAmount * 0.3);

            try {
              const User = (await import('../models/User.js')).default;
              await User.updateOne(
                { _id: plain._id },
                {
                  $set: {
                    totalCalculatedFee: finalRevisedAmount,
                    calculatedTerm1Fee: term1,
                    calculatedTerm2Fee: term2,
                    calculatedTerm3Fee: term3
                  }
                }
              );
              console.log(`🔄 [enrichStudentAcademics] Live updated MongoDB User ${plain.rollNumber} with revised fee from SQL: ₹${finalRevisedAmount}`);

              // Update in-memory returned object
              enriched.totalCalculatedFee = finalRevisedAmount;
              enriched.calculatedTerm1Fee = term1;
              enriched.calculatedTerm2Fee = term2;
              enriched.calculatedTerm3Fee = term3;

              // Trigger sync to central fee database in the background
              const { syncStudentHostelFeeSafely } = await import('../services/feesSyncService.js');
              syncStudentHostelFeeSafely(enriched, { academicYear: enriched.academicYear }).catch(err => {
                console.error('❌ Error syncing revised fee in background:', err);
              });
            } catch (dbErr) {
              console.error('❌ Error updating revised fee in MongoDB during enrichment:', dbErr);
            }
          }
        }
      }
    }
  }

  return enriched;
};

/**
 * Batch-enrich students (batched SQL queries, avoids pool exhaustion).
 */
export const enrichStudentsAcademics = async (students, options = {}) => {
  if (!students?.length) return [];

  const skipFeesAndConcessions = options.skipFeesAndConcessions || false;

  const identifiers = [...new Set(
    students.flatMap((s) =>
      [s.rollNumber, s.admissionNumber]
        .map(normalizeKey)
        .filter(Boolean)
    )
  )];

  await loadIdentifiersBatch(identifiers);

  // Batch fetch concessions in a single SQL query
  const concessionsMap = new Map();
  if (!skipFeesAndConcessions) {
    try {
      const concessionsResult = await fetchConcessionsForStudents(identifiers);
      if (concessionsResult.success && concessionsResult.data) {
        concessionsResult.data.forEach(c => {
          const keyPin = normalizeKey(c.pin_no);
          const keyAdm = normalizeKey(c.admission_number);
          if (keyPin) concessionsMap.set(keyPin, c);
          if (keyAdm) concessionsMap.set(keyAdm, c);
        });
      }
    } catch (err) {
      console.error('❌ Error batch fetching concessions during enrichment:', err);
    }
  }

  return Promise.all(
    students.map((s) => {
      const rollKey = normalizeKey(s.rollNumber);
      const admKey = normalizeKey(s.admissionNumber);
      const preFetched = (rollKey && concessionsMap.get(rollKey))
        || (admKey && concessionsMap.get(admKey))
        || null;
      return enrichStudentAcademics(s, preFetched, options);
    })
  );
};

export const matchesAcademicFilters = (student, filters = {}) => {
  const { course, branch, year } = filters;
  const norm = (v) => (v || '').toString().trim().toUpperCase();

  if (course?.trim() && norm(student.course) !== norm(course)) return false;
  if (branch?.trim() && norm(student.branch) !== norm(branch)) return false;
  if (year != null && year !== '' && Number(student.year) !== Number(year)) return false;
  return true;
};

export const clearAcademicsCache = () => academicsCache.clear();
