import express from 'express';
import { adminAuth } from '../middleware/authMiddleware.js';
import {
  listStudentMasters,
  getStudentMasterByAdmission,
  createOrSyncStudentMaster
} from '../controllers/studentMasterController.js';

const router = express.Router();

// Canonical: /api/student-masters
router.get('/', adminAuth, listStudentMasters);
router.post('/', adminAuth, createOrSyncStudentMaster);
router.get('/:admissionNumber', adminAuth, getStudentMasterByAdmission);

export default router;
