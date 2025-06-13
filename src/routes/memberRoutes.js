import express from 'express';
import { adminAuth } from '../middleware/authMiddleware.js';
import {
  getAllMembers,
  getMembersByCategory,
  addMember,
  updateMember,
  deleteMember,
  reactivateMember
} from '../controllers/memberController.js';

const router = express.Router();

// Member routes
router.get('/', adminAuth, getAllMembers);
router.get('/category/:category', adminAuth, getMembersByCategory);
router.post('/', adminAuth, addMember);
router.put('/:id', adminAuth, updateMember);
router.delete('/:id', adminAuth, deleteMember);

router.route('/:id/reactivate')
  .put(adminAuth, reactivateMember);

export default router; 