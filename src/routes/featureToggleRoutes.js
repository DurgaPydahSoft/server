import express from 'express';
import { adminAuth, protect } from '../middleware/authMiddleware.js';
import {
  getFeatureToggles,
  updateFeatureToggles,
  getStudentFeatureToggles,
  resetFeatureToggles
} from '../controllers/featureToggleController.js';

const router = express.Router();

// Admin routes - require admin authentication
router.get('/admin', adminAuth, getFeatureToggles);
router.put('/admin', adminAuth, updateFeatureToggles);
router.post('/admin/reset', adminAuth, resetFeatureToggles);

// Student routes - require student authentication
router.get('/student', protect, (req, res, next) => {
  if (req.user?.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Access denied. Students only.' });
  }
  next();
}, getStudentFeatureToggles);

export default router; 