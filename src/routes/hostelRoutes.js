import express from 'express';
import { adminAuth } from '../middleware/authMiddleware.js';
import { createHostel, getHostels, createHostelCategory, getHostelCategories } from '../controllers/hostelController.js';

const router = express.Router();

router.get('/', adminAuth, getHostels);
router.post('/', adminAuth, createHostel);

router.get('/:hostelId/categories', adminAuth, getHostelCategories);
router.post('/:hostelId/categories', adminAuth, createHostelCategory);

export default router;

