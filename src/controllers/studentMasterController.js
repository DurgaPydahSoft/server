import StudentMaster from '../models/StudentMaster.js';
import { createError } from '../utils/error.js';
import { fetchStudentByIdentifier, testSQLConnection } from '../utils/sqlService.js';
import { parseSqlStudentRow } from '../utils/studentAcademicEnricher.js';

const normalizeAdmission = (value) => (value || '').toString().trim().toUpperCase();

/**
 * Upsert a minimal student master from admission number + optional profile fields.
 * Prefer SDMS for identity fields when available.
 */
export const upsertStudentMaster = async ({
  admissionNumber,
  rollNumber,
  name,
  studentPhone,
  parentPhone,
  motherName,
  motherPhone,
  localGuardianName,
  localGuardianPhone,
  email,
  studentPhoto,
  guardianPhoto1,
  guardianPhoto2,
  userId,
  createdBy,
  syncFromSdms = true
}) => {
  const admission = normalizeAdmission(admissionNumber);
  if (!admission) {
    throw createError(400, 'Admission number is required');
  }

  let sdms = null;
  if (syncFromSdms) {
    try {
      const connectionTest = await testSQLConnection();
      if (connectionTest.success) {
        let sqlResult = await fetchStudentByIdentifier(admission);
        if (!sqlResult.success && rollNumber) {
          sqlResult = await fetchStudentByIdentifier(rollNumber);
        }
        if (sqlResult.success) {
          sdms = await parseSqlStudentRow(sqlResult.data);
        }
      }
    } catch (err) {
      console.warn('SDMS sync skipped for StudentMaster:', err.message);
    }
  }

  const payload = {
    admissionNumber: admission,
    name: sdms?.name || name,
    rollNumber: normalizeAdmission(sdms?.rollNumber || rollNumber) || undefined,
    studentPhone: sdms?.studentPhone || studentPhone,
    parentPhone: sdms?.parentPhone || parentPhone,
    motherName: motherName,
    motherPhone: sdms?.motherPhone || motherPhone,
    localGuardianName,
    localGuardianPhone,
    email: email || undefined,
    studentPhoto: sdms?.studentPhoto || studentPhoto,
    guardianPhoto1,
    guardianPhoto2,
    lastSdmsSyncAt: sdms ? new Date() : undefined
  };

  if (userId) payload.userId = userId;
  if (createdBy) payload.createdBy = createdBy;

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  const master = await StudentMaster.findOneAndUpdate(
    { admissionNumber: admission },
    { $set: payload },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return { master, sdms };
};

export const listStudentMasters = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const query = { isActive: true };

    if (search) {
      const term = search.trim();
      query.$or = [
        { admissionNumber: { $regex: term, $options: 'i' } },
        { rollNumber: { $regex: term, $options: 'i' } },
        { name: { $regex: term, $options: 'i' } }
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      StudentMaster.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).lean(),
      StudentMaster.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        current: pageNum,
        pages: Math.ceil(total / limitNum),
        total
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getStudentMasterByAdmission = async (req, res, next) => {
  try {
    const admission = normalizeAdmission(req.params.admissionNumber);
    const master = await StudentMaster.findOne({ admissionNumber: admission }).lean();
    if (!master) {
      throw createError(404, 'Student master not found');
    }
    res.json({ success: true, data: master });
  } catch (error) {
    next(error);
  }
};

export const createOrSyncStudentMaster = async (req, res, next) => {
  try {
    const { master, sdms } = await upsertStudentMaster({
      ...req.body,
      createdBy: req.admin?._id,
      syncFromSdms: req.body.syncFromSdms !== false
    });

    res.status(201).json({
      success: true,
      data: master,
      sdmsSynced: Boolean(sdms)
    });
  } catch (error) {
    next(error);
  }
};
