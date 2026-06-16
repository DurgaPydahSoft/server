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
import { adminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

const feeManagementAuth = [adminAuth, (req, res, next) => {
  if (req.admin?.role === 'super_admin') {
    return next();
  }
  
  if (req.admin?.permissions?.includes('fee_management')) {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied. You need fee_management permission.'
  });
}];

const feeManagementWriteAuth = [adminAuth, (req, res, next) => {
  if (req.admin?.role === 'super_admin') {
    return next();
  }
  
  if (!req.admin?.permissions?.includes('fee_management')) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You need fee_management permission.'
    });
  }
  
  const accessLevel = req.admin?.permissionAccessLevels?.get?.('fee_management') 
    || req.admin?.permissionAccessLevels?.['fee_management'] 
    || 'view';
  
  if (accessLevel !== 'full') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You need full access to fee_management to perform this action.'
    });
  }
  
  return next();
}];

// Test and utility routes
router.get('/test', testFeeStructure);
router.post('/create-sample', feeManagementWriteAuth, createSampleFeeStructures);
router.post('/fix-inactive', feeManagementWriteAuth, fixInactiveFeeStructures);

// Main CRUD routes
router.get('/', getFeeStructures);
router.get('/courses', getCourses);
router.get('/courses/:courseId/years', getCourseYears);
router.get('/academic-years', getAcademicYears);
router.get('/stats', getFeeStructureStats);
router.get('/admit-card/:academicYear/:course/:branch/:year/:category', getFeeStructureForAdmitCard);
router.get('/:academicYear/:course/:branch/:year/:category', getFeeStructure);

// Admin only routes
router.post('/', feeManagementWriteAuth, createOrUpdateFeeStructure);
router.delete('/:academicYear/:course/:branch/:year/:category', feeManagementWriteAuth, deleteFeeStructure);

// Additional fees routes (common for all students per academic year)
router.get('/additional-fees/:academicYear', getAdditionalFees);
router.post('/additional-fees', feeManagementWriteAuth, setAdditionalFees);

export default router; 