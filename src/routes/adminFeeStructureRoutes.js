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
const adminOnly = [adminAuth, restrictTo('super_admin', 'admin')];

router.get('/', adminOnly, listAdminFeeStructures);
router.post('/', adminOnly, createAdminFeeStructure);
router.put('/:id', adminOnly, updateAdminFeeStructure);
router.delete('/:id', adminOnly, deleteAdminFeeStructure);

// Additional fees (admin scoped)
router.get('/additional-fees/:academicYear', adminOnly, getAdditionalFees);
router.post('/additional-fees', adminOnly, setAdditionalFees);

export default router;

