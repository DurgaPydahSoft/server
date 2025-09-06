import express from 'express';
import {
  getStaffForAttendance,
  takeStaffAttendance,
  getStaffAttendanceForDate,
  getStaffAttendanceForDateRange,
  getStaffAttendanceStats,
  updateStaffAttendance,
  deleteStaffAttendance,
  getStaffCount
} from '../controllers/staffAttendanceController.js';
import { protect, adminAuth, wardenAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin and Warden routes - using adminAuth which should handle both admin and warden roles
router.get('/staff', adminAuth, getStaffForAttendance);
router.post('/take', adminAuth, takeStaffAttendance);
router.get('/date', adminAuth, getStaffAttendanceForDate);
router.get('/range', adminAuth, getStaffAttendanceForDateRange);
router.get('/stats', adminAuth, getStaffAttendanceStats);
router.put('/update', adminAuth, updateStaffAttendance);
router.delete('/:staffId/:date', adminAuth, deleteStaffAttendance);
router.get('/count', adminAuth, getStaffCount);

// Warden-specific routes
router.get('/warden/staff', wardenAuth, getStaffForAttendance);
router.post('/warden/take', wardenAuth, takeStaffAttendance);
router.get('/warden/date', wardenAuth, getStaffAttendanceForDate);
router.get('/warden/range', wardenAuth, getStaffAttendanceForDateRange);
router.get('/warden/stats', wardenAuth, getStaffAttendanceStats);
router.get('/warden/count', wardenAuth, getStaffCount);

export default router;
