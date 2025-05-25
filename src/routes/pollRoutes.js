import express from 'express';
import {
  createPoll,
  getAllPolls,
  getActivePolls,
  votePoll,
  endPoll,
  deletePoll,
  getPollResults
} from '../controllers/pollController.js';
import { adminAuth, authenticateStudent } from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin routes
router.post('/', adminAuth, createPoll);
router.get('/admin/all', adminAuth, getAllPolls);
router.post('/:pollId/end', adminAuth, endPoll);
router.delete('/:pollId', adminAuth, deletePoll);

// Student routes
router.get('/active', authenticateStudent, getActivePolls);
router.post('/:pollId/vote', authenticateStudent, votePoll);
router.get('/:pollId/results', authenticateStudent, getPollResults);

export default router; 