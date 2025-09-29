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

// Super Admin routes
router.get('/admin/all', adminAuth, getAllNOCRequests);
router.post('/admin/:id/approve', adminAuth, approveNOCRequest);
router.post('/admin/:id/reject', adminAuth, rejectNOCRequest);
router.get('/admin/stats', adminAuth, getNOCStats);

export default router;
