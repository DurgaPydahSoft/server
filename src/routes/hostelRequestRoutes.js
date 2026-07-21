import express from 'express';
import { adminAuth } from '../middleware/authMiddleware.js';
import {
  createHostelRequest,
  listHostelRequests,
  getHostelRequestById,
  updateHostelRequestStatus,
  updateHostelRequestAllocation
} from '../controllers/hostelRequestController.js';

const router = express.Router();

// Canonical: /api/hostel-requests  (mounted once via routes/index.js — no dual mount)
router.get('/', adminAuth, listHostelRequests);
router.post('/', adminAuth, createHostelRequest);
router.get('/:id', adminAuth, getHostelRequestById);
router.patch('/:id/status', adminAuth, updateHostelRequestStatus);
router.patch('/:id/allocation', adminAuth, updateHostelRequestAllocation);

export default router;
