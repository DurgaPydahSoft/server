import express from 'express';
import {
  createBulkOuting,
  getWardenBulkOutings,
  getAllBulkOutings,
  approveBulkOuting,
  rejectBulkOuting,
  getStudentsForBulkOuting,
  getBulkOutingStudents
} from '../controllers/bulkOutingController.js';
import { adminAuth, wardenAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Warden routes
router.post('/create', wardenAuth, createBulkOuting);
router.get('/warden', wardenAuth, getWardenBulkOutings);
router.get('/warden/students', wardenAuth, getStudentsForBulkOuting);

// Admin routes
router.get('/admin', adminAuth, getAllBulkOutings);
router.get('/admin/:bulkOutingId/students', adminAuth, getBulkOutingStudents);
router.post('/admin/:bulkOutingId/approve', adminAuth, approveBulkOuting);
router.post('/admin/:bulkOutingId/reject', adminAuth, rejectBulkOuting);

export default router; 