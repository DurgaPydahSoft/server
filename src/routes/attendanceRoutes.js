import express from 'express';
import {
  getStudentsForAttendance,
  takeAttendance,
  getAttendanceForDate,
  getAttendanceForDateRange,
  getMyAttendance,
  getAttendanceStats,
  updateAttendance,
  deleteAttendance,
  getPrincipalAttendanceForDate,
  getPrincipalAttendanceForRange,
  getPrincipalAttendanceStats
} from '../controllers/attendanceController.js';
import { protect, adminAuth, wardenAuth, principalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin and Warden routes
router.get('/students', adminAuth, getStudentsForAttendance);
router.post('/take', adminAuth, takeAttendance);
router.get('/date', adminAuth, getAttendanceForDate);
router.get('/range', adminAuth, getAttendanceForDateRange);
router.get('/stats', adminAuth, getAttendanceStats);
router.put('/update', adminAuth, updateAttendance);
router.delete('/:studentId/:date', adminAuth, deleteAttendance);

// Student routes
router.get('/my-attendance', protect, getMyAttendance);

// Principal routes
router.get('/principal/date', principalAuth, getPrincipalAttendanceForDate);
router.get('/principal/range', principalAuth, getPrincipalAttendanceForRange);
router.get('/principal/stats', principalAuth, getPrincipalAttendanceStats);

export default router;