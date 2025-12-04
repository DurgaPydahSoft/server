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
  fixInactiveFeeStructures,
  getFeeStructureForAdmitCard,
  getCourses,
  getCourseYears,
  getAdditionalFees,
  setAdditionalFees
} from '../controllers/feeStructureController.js';
import { adminAuth, restrictTo } from '../middleware/authMiddleware.js';

const router = express.Router();

// Test and utility routes
router.get('/test', testFeeStructure);
router.post('/create-sample', adminAuth, restrictTo('super_admin', 'admin'), createSampleFeeStructures);
router.post('/fix-inactive', adminAuth, restrictTo('super_admin', 'admin'), fixInactiveFeeStructures);

// Main CRUD routes
router.get('/', getFeeStructures);
router.get('/courses', getCourses);
router.get('/courses/:courseId/years', getCourseYears);
router.get('/academic-years', getAcademicYears);
router.get('/stats', getFeeStructureStats);
router.get('/admit-card/:academicYear/:course/:year/:category', getFeeStructureForAdmitCard);
router.get('/:academicYear/:course/:year/:category', getFeeStructure);

// Admin only routes
router.post('/', adminAuth, restrictTo('super_admin', 'admin'), createOrUpdateFeeStructure);
router.delete('/:academicYear/:course/:year/:category', adminAuth, restrictTo('super_admin', 'admin'), deleteFeeStructure);

// Additional fees routes (common for all students per academic year)
router.get('/additional-fees/:academicYear', getAdditionalFees);
router.post('/additional-fees', adminAuth, restrictTo('super_admin', 'admin'), setAdditionalFees);

export default router; 