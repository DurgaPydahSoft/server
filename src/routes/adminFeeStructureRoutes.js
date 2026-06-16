import express from 'express';
import {
  listAdminFeeStructures,
  createAdminFeeStructure,
  updateAdminFeeStructure,
  deleteAdminFeeStructure,
  getAdditionalFees,
  setAdditionalFees,
} from '../controllers/feeStructureController.js';
import { adminAuth, restrictTo } from '../middleware/authMiddleware.js';

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

router.get('/', feeManagementAuth, listAdminFeeStructures);
router.post('/', feeManagementWriteAuth, createAdminFeeStructure);
router.put('/:id', feeManagementWriteAuth, updateAdminFeeStructure);
router.delete('/:id', feeManagementWriteAuth, deleteAdminFeeStructure);

// Additional fees (admin scoped)
router.get('/additional-fees/:academicYear', feeManagementAuth, getAdditionalFees);
router.post('/additional-fees', feeManagementWriteAuth, setAdditionalFees);

export default router;

