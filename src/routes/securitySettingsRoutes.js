import express from 'express';
import { getSettings, updateSettings } from '../controllers/securitySettingsController.js';
// Optionally, add authentication middleware for admin-only access
// import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/security-settings - Get current security settings
router.get('/', getSettings);

// PUT /api/security-settings - Update security settings
router.put('/', updateSettings);

export default router; 