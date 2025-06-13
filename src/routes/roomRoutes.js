import express from 'express';
import { adminAuth, authenticateStudent } from '../middleware/authMiddleware.js';
import {
  getRooms,
  addRoom,
  updateRoom,
  deleteRoom,
  getRoomStats,
  getRoomStudents,
  addOrUpdateElectricityBill,
  getElectricityBills,
  getStudentRoomBills,
  getDefaultElectricityRate
} from '../controllers/roomController.js';

const router = express.Router();

// Get all rooms with optional filtering
router.get('/', adminAuth, getRooms);

// Get room statistics
router.get('/stats', adminAuth, getRoomStats);

// Get students in a specific room
router.get('/:roomId/students', adminAuth, getRoomStudents);

// Add a new room
router.post('/', adminAuth, addRoom);

// Update a room
router.put('/:id', adminAuth, updateRoom);

// Delete a room
router.delete('/:id', adminAuth, deleteRoom);

// Admin electricity bill routes
router.post('/:roomId/electricity-bill', adminAuth, addOrUpdateElectricityBill);
router.get('/:roomId/electricity-bill', adminAuth, getElectricityBills);
router.get('/electricity-default-rate', adminAuth, getDefaultElectricityRate);

// Student electricity bill route
router.get('/student/electricity-bills', authenticateStudent, getStudentRoomBills);

export default router; 