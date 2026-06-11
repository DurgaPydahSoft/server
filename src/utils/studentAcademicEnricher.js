import { fetchStudentByIdentifier } from './sqlService.js';
import { matchCourseAndBranch } from './courseBranchMatcher.js';
import { normalizeBatchToYear } from './batchUtils.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const academicsCache = new Map();

const normalizeKey = (value) => (value || '').toString().trim().toUpperCase();

const toPlainStudent = (student) => {
  if (!student) return null;
  if (typeof student.toObject === 'function') return student.toObject();
  return { ...student };
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
    // Contact phones — SQL source of truth (same as academics)
    studentPhone: (sqlRow.student_mobile || '').toString().trim(),
    parentPhone: (sqlRow.parent_mobile1 || '').toString().trim(),
    motherPhone: (sqlRow.parent_mobile2 || '').toString().trim(),
    academicSource: 'sql'
  };
};

/**
 * Load academics from SQL by PIN / admission number (cached).
 */
export const loadAcademicsFromSQL = async (identifier) => {
  const key = normalizeKey(identifier);
  if (!key) return null;

  const cached = academicsCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const result = await fetchStudentByIdentifier(key);
  if (!result.success || !result.data) {
    return null;
  }

  const data = await parseSqlStudentRow(result.data);
  academicsCache.set(key, { ts: Date.now(), data });
  return data;
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
 * Batch-enrich students (deduplicates SQL lookups).
 */
export const enrichStudentsAcademics = async (students) => {
  if (!students?.length) return [];

  const identifiers = [
    ...new Set(
      students
        .map(s => normalizeKey(s.rollNumber || s.admissionNumber))
        .filter(Boolean)
    )
  ];

  await Promise.all(identifiers.map(id => loadAcademicsFromSQL(id)));

  return Promise.all(students.map(s => enrichStudentAcademics(s)));
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
