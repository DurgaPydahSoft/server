import express from 'express';
import { adminAuth, wardenAuth } from '../middleware/authMiddleware.js';
import {
  createRoomChange,
  listRoomChanges,
  getRoomHistory,
  listHistoryStudents,
  listActiveStudentsForRoomChange,
  approveRoomChange,
  rejectRoomChange
} from '../controllers/roomChangeController.js';

const router = express.Router();

// Warden routes first so "/warden" is not captured by "/:id"
router.post('/warden', wardenAuth, createRoomChange);
router.get('/warden/students', wardenAuth, listActiveStudentsForRoomChange);
router.get('/warden/history-students', wardenAuth, listHistoryStudents);
router.get('/warden/history', wardenAuth, getRoomHistory);
router.get('/warden', wardenAuth, listRoomChanges);
router.post('/warden/:id/approve', wardenAuth, approveRoomChange);
router.post('/warden/:id/reject', wardenAuth, rejectRoomChange);

// Admin routes
router.get('/students', adminAuth, listActiveStudentsForRoomChange);
router.get('/history-students', adminAuth, listHistoryStudents);
router.get('/history', adminAuth, getRoomHistory);
router.post('/', adminAuth, createRoomChange);
router.get('/', adminAuth, listRoomChanges);
router.post('/:id/approve', adminAuth, approveRoomChange);
router.post('/:id/reject', adminAuth, rejectRoomChange);

export default router;
