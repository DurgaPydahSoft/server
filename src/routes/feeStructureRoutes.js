import express from 'express';
import {
  getFeeStructures,
  getFeeStructure,
  createOrUpdateFeeStructure,
  deleteFeeStructure,
  getAcademicYears,
  getFeeStructureStats,
  testFeeStructure,
  createSampleFeeStructures,
  fixInactiveFeeStructures
} from '../controllers/feeStructureController.js';
import { adminAuth, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

// Test and utility routes
router.get('/test', testFeeStructure);
router.post('/create-sample', adminAuth, restrictTo('super_admin', 'admin'), createSampleFeeStructures);
router.post('/fix-inactive', adminAuth, restrictTo('super_admin', 'admin'), fixInactiveFeeStructures);

// Main CRUD routes
router.get('/', getFeeStructures);
router.get('/academic-years', getAcademicYears);
router.get('/stats', getFeeStructureStats);
router.get('/:academicYear/:category', getFeeStructure);

// Admin only routes
router.post('/', adminAuth, restrictTo('super_admin', 'admin'), createOrUpdateFeeStructure);
router.delete('/:academicYear/:category', adminAuth, restrictTo('super_admin', 'admin'), deleteFeeStructure);

export default router; 