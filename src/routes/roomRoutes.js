import express from 'express';
import jwt from 'jsonwebtoken';
import { adminAuth, wardenAuth, authenticateStudent, protect } from '../middleware/authMiddleware.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import {
  getRooms,
  getWardenRooms,
  addRoom,
  updateRoom,
  deleteRoom,
  getRoomStats,
  getRoomStudents,
  addOrUpdateElectricityBill,
  getElectricityBills,
  getStudentRoomBills,
  getDefaultElectricityRate,
  setDefaultElectricityRate,
  addBulkElectricityBills,
  clearElectricityBillsForMonth,
  getRoomsWithBedAvailability,
  getCategories
} from '../controllers/roomController.js';

const router = express.Router();

// Get all rooms with optional filtering - check if user is admin or student
router.get('/', async (req, res, next) => {
  try {
    console.log('🔐 Room route authentication check');
    console.log('🔐 JWT_SECRET exists:', !!process.env.JWT_SECRET);
    
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('🔐 Token received:', token ? 'Yes' : 'No');
    }

    if (!token) {
      console.log('🔐 No token found');
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    console.log('🔐 Attempting to verify token...');
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('🔐 Token decoded successfully:', { _id: decoded._id, role: decoded.role });
    } catch (jwtError) {
      console.error('🔐 JWT verification failed:', jwtError.message);
      return res.status(401).json({ 
        message: 'Not authorized, token failed',
        error: jwtError.message 
      });
    }
    
    // Check if it's an admin
    const admin = await Admin.findById(decoded._id).select('-password');
    console.log('🔐 Admin lookup result:', admin ? { _id: admin._id, role: admin.role, isActive: admin.isActive } : 'Not found');
    
    if (admin && admin.isActive) {
      // It's an admin, attach admin info and proceed
      req.admin = admin;
      req.user = admin; // For compatibility with existing code
      console.log('🔐 Admin authenticated successfully');
      return next();
    }
    
    // Check if it's a student
    const user = await User.findById(decoded._id).select('-password');
    console.log('🔐 User lookup result:', user ? { _id: user._id, role: user.role } : 'Not found');
    
    if (user && user.role === 'student') {
      // It's a student, attach user info and proceed
      req.user = user;
      console.log('🔐 Student authenticated successfully');
      return next();
    }
    
    // Neither admin nor student found
    console.log('🔐 Neither admin nor student found');
    return res.status(404).json({ message: 'User not found' });
    
  } catch (error) {
    console.error('🔐 Room route authentication error:', error);
    return res.status(401).json({ 
      message: 'Not authorized, token failed',
      error: error.message 
    });
  }
}, getRooms);

// Get room statistics - admin only
router.get('/stats', adminAuth, getRoomStats);

// Get all distinct categories - public (for fee management)
router.get('/categories', getCategories);

// Get rooms with bed availability for student registration - admin only
router.get('/bed-availability', adminAuth, getRoomsWithBedAvailability);

// Get rooms for warden - warden only
router.get('/warden', wardenAuth, getWardenRooms);

// Get students in a specific room - admin only
router.get('/:roomId/students', adminAuth, getRoomStudents);

// Add a new room - admin only
router.post('/', adminAuth, addRoom);

// Update a room - admin only
router.put('/:id', adminAuth, updateRoom);

// Delete a room - admin only
router.delete('/:id', adminAuth, deleteRoom);

// Admin electricity bill routes - admin only
router.post('/bulk-electricity-bills', adminAuth, addBulkElectricityBills);
router.post('/clear-electricity-bills-for-month', adminAuth, clearElectricityBillsForMonth);
router.post('/:roomId/electricity-bill', adminAuth, addOrUpdateElectricityBill);
router.get('/:roomId/electricity-bill', adminAuth, getElectricityBills);
router.get('/electricity-default-rate', adminAuth, getDefaultElectricityRate);
router.post('/electricity-default-rate', adminAuth, setDefaultElectricityRate);

// Warden electricity bill routes - warden only
router.post('/warden/bulk-electricity-bills', wardenAuth, addBulkElectricityBills);
router.post('/warden/:roomId/electricity-bill', wardenAuth, addOrUpdateElectricityBill);
router.get('/warden/:roomId/electricity-bill', wardenAuth, getElectricityBills);
router.get('/warden/electricity-default-rate', wardenAuth, getDefaultElectricityRate);

// Student electricity bill route - student only
router.get('/student/electricity-bills', authenticateStudent, getStudentRoomBills);

export default router; 