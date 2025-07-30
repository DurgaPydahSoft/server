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
  getPrincipalAttendanceStats,
  getPrincipalStudentCount,
  getPrincipalStudentsByStatus,
  generateAttendanceReport
} from '../controllers/attendanceController.js';
import { protect, adminAuth, wardenAuth, principalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin and Warden routes - using adminAuth which should handle both admin and warden roles
router.get('/students', adminAuth, getStudentsForAttendance);
router.post('/take', adminAuth, takeAttendance);
router.get('/date', adminAuth, getAttendanceForDate);
router.get('/range', adminAuth, getAttendanceForDateRange);
router.get('/stats', adminAuth, getAttendanceStats);
router.put('/update', adminAuth, updateAttendance);
router.delete('/:studentId/:date', adminAuth, deleteAttendance);
router.get('/report', adminAuth, generateAttendanceReport);

// Warden-specific routes (if needed)
router.get('/warden/date', wardenAuth, getAttendanceForDate);
router.get('/warden/range', wardenAuth, getAttendanceForDateRange);
router.get('/warden/report', wardenAuth, generateAttendanceReport);

// Student routes
router.get('/my-attendance', protect, getMyAttendance);

// Principal routes
router.get('/principal/date', principalAuth, getPrincipalAttendanceForDate);
router.get('/principal/range', principalAuth, getPrincipalAttendanceForRange);
router.get('/principal/stats', principalAuth, getPrincipalAttendanceStats);
router.get('/principal/students/count', principalAuth, getPrincipalStudentCount);
router.get('/principal/students/by-status', principalAuth, getPrincipalStudentsByStatus);
router.get('/principal/report', principalAuth, generateAttendanceReport);

export default router;