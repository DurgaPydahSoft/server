import express from 'express';
import {
  createNOCRequest,
  getStudentNOCRequests,
  getNOCRequestById,
  deleteNOCRequest,
  getWardenNOCRequests,
  wardenVerifyNOC,
  wardenRejectNOC,
  getAllNOCRequests,
  approveNOCRequest,
  rejectNOCRequest,
  getNOCStats
} from '../controllers/nocController.js';
import { authenticateStudent, wardenAuth, adminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Middleware for NOC management permission
const nocManagementAuth = [adminAuth, (req, res, next) => {
  // Super admin always has access
  if (req.admin?.role === 'super_admin') {
    return next();
  }
  
  // Check if user has noc_management permission
  if (req.admin?.permissions?.includes('noc_management')) {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied. You need noc_management permission.'
  });
}];

// Debug middleware to log all requests
router.use((req, res, next) => {
  console.log(`🔍 NOC route accessed: ${req.method} ${req.path}`);
  next();
});

// Student routes
router.post('/student/create', authenticateStudent, createNOCRequest);
router.get('/student/my-requests', authenticateStudent, getStudentNOCRequests);
router.get('/student/:id', authenticateStudent, getNOCRequestById);
router.delete('/student/:id', authenticateStudent, deleteNOCRequest);

// Warden routes
router.get('/warden/all', wardenAuth, getWardenNOCRequests);
router.post('/warden/:id/verify', wardenAuth, wardenVerifyNOC);
router.post('/warden/:id/reject', wardenAuth, wardenRejectNOC);

// Admin routes (requires noc_management permission)
router.get('/admin/all', nocManagementAuth, getAllNOCRequests);
router.post('/admin/:id/approve', nocManagementAuth, approveNOCRequest);
router.post('/admin/:id/reject', nocManagementAuth, rejectNOCRequest);
router.get('/admin/stats', nocManagementAuth, getNOCStats);

export default router;
