import express from 'express';
import { adminAuth, wardenAuth } from '../middleware/authMiddleware.js';
import {
  createCategoryChange,
  listCategoryChanges,
  listHistoryStudents,
  listActiveStudentsForCategoryChange,
  getFeePreview,
  approveCategoryChange,
  rejectCategoryChange
} from '../controllers/categoryChangeController.js';

const router = express.Router();

router.post('/warden', wardenAuth, createCategoryChange);
router.get('/warden/students', wardenAuth, listActiveStudentsForCategoryChange);
router.get('/warden/history-students', wardenAuth, listHistoryStudents);
router.get('/warden/fee-preview', wardenAuth, getFeePreview);
router.get('/warden', wardenAuth, listCategoryChanges);
router.post('/warden/:id/approve', wardenAuth, approveCategoryChange);
router.post('/warden/:id/reject', wardenAuth, rejectCategoryChange);

router.get('/students', adminAuth, listActiveStudentsForCategoryChange);
router.get('/history-students', adminAuth, listHistoryStudents);
router.get('/fee-preview', adminAuth, getFeePreview);
router.post('/', adminAuth, createCategoryChange);
router.get('/', adminAuth, listCategoryChanges);
router.post('/:id/approve', adminAuth, approveCategoryChange);
router.post('/:id/reject', adminAuth, rejectCategoryChange);

export default router;
