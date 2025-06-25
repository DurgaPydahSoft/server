import express from 'express';
import { getSettings, updateSettings } from '../controllers/securitySettingsController.js';
// Optionally, add authentication middleware for admin-only access
// import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getSettings);
router.post('/', updateSettings);

export default router; 