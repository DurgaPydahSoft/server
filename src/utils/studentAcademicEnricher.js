import { fetchStudentByIdentifier, fetchStudentsByIdentifiers } from './sqlService.js';
import { matchCourseAndBranch } from './courseBranchMatcher.js';
import { normalizeBatchToYear } from './batchUtils.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAIL_CACHE_TTL_MS = 60 * 1000;
const BATCH_CHUNK_SIZE = 40;
const MAX_CONCURRENT_BATCHES = 2;

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

  if (course) {
    const match = await matchCourseAndBranch(course, branch);
    if (match.success) {
      course = match.courseName || course;
      branch = match.branchName || branch;
      courseId = match.courseId;
      branchId = match.branchId;
      if (courseId?.toString().startsWith('sql_')) {
        sqlCourseId = parseInt(courseId.toString().replace('sql_', ''), 10);
      }
      if (branchId?.toString().startsWith('sql_')) {
        sqlBranchId = parseInt(branchId.toString().replace('sql_', ''), 10);
      }
    }
  }

  return {
    course,
    branch,
    year: sqlRow.current_year ? parseInt(sqlRow.current_year, 10) : 1,
    batch: normalizeBatchToYear(sqlRow.batch),
    courseId,
    branchId,
    sqlCourseId,
    sqlBranchId,
    studentPhone: (sqlRow.student_mobile || '').toString().trim(),
    parentPhone: (sqlRow.parent_mobile1 || '').toString().trim(),
    motherPhone: (sqlRow.parent_mobile2 || '').toString().trim(),
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
export const enrichStudentAcademics = async (student) => {
  const plain = toPlainStudent(student);
  if (!plain) return plain;

  const identifier = plain.rollNumber || plain.admissionNumber;
  const sqlAcademics = await loadAcademicsFromSQL(identifier);

  if (sqlAcademics) {
    return {
      ...plain,
      ...sqlAcademics,
      academicSource: 'sql'
    };
  }

  return {
    ...plain,
    academicSource: plain.course ? 'mongo' : 'unknown'
  };
};

/**
 * Batch-enrich students (batched SQL queries, avoids pool exhaustion).
 */
export const enrichStudentsAcademics = async (students) => {
  if (!students?.length) return [];

  const identifiers = students
    .map((s) => normalizeKey(s.rollNumber || s.admissionNumber))
    .filter(Boolean);

  await loadIdentifiersBatch(identifiers);

  return Promise.all(students.map((s) => enrichStudentAcademics(s)));
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
