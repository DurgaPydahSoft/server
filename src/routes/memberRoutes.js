import express from 'express';
import { protect, restrictTo } from '../middleware/authMiddleware.js';
import {
  getAllMembers,
  getMembersByCategory,
  addMember,
  updateMember,
  deleteMember,
  reactivateMember
} from '../controllers/memberController.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(restrictTo('admin'));

// Member routes
router.get('/', getAllMembers);
router.get('/category/:category', getMembersByCategory);
router.post('/', addMember);
router.put('/:id', updateMember);
router.delete('/:id', deleteMember);

router.route('/:id/reactivate')
  .put(reactivateMember);

export default router; 