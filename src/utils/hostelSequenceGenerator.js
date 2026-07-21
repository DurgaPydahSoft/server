import Counter from '../models/Counter.js';
import { createError } from './error.js';

const normalizeCode = (value, label) => {
  const code = (value || '').toString().trim().toUpperCase();
  if (!code) {
    throw createError(400, `${label} code is required for sequence generation`);
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    throw createError(400, `${label} code must contain only letters and numbers`);
  }
  return code;
};

const normalizeAcademicYear = (academicYear) => {
  const ay = (academicYear || '').toString().trim();
  if (!/^\d{4}-\d{4}$/.test(ay)) {
    throw createError(400, 'Valid academic year (YYYY-YYYY) is required for sequence generation');
  }
  const [start, end] = ay.split('-').map(Number);
  if (end !== start + 1) {
    throw createError(400, 'Academic year must span exactly one calendar year');
  }
  return ay;
};

/**
 * Generate an academic-year scoped hostel sequence:
 * College Code + Course Code + Hostel Code + zero-padded sequence number
 */
export const generateHostelSequenceId = async ({
  academicYear,
  collegeCode,
  courseCode,
  hostelCode,
  sequencePadLength = 3
}) => {
  const ay = normalizeAcademicYear(academicYear);
  const college = normalizeCode(collegeCode, 'College');
  const course = normalizeCode(courseCode, 'Course');
  const hostel = normalizeCode(hostelCode, 'Hostel');

  const counterId = `hostelseq:${ay}:${college}:${course}:${hostel}`;

  const counter = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const yearlySequenceNumber = counter.sequence;
  const hostelSequenceId = `${college}${course}${hostel}${String(yearlySequenceNumber).padStart(sequencePadLength, '0')}`;

  return {
    academicYear: ay,
    collegeCode: college,
    courseCode: course,
    hostelCode: hostel,
    yearlySequenceNumber,
    hostelSequenceId,
    counterId
  };
};
