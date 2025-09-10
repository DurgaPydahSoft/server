import express from 'express';
import {
  getGlobalSettings,
  updateGlobalSettings,
  getSettingByKey,
  updateSettingByKey,
  resetSettingsToDefault
} from '../controllers/globalSettingsController.js';
import { adminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Global settings routes
// GET routes are public (for displaying institution info)
router.get('/', getGlobalSettings);
router.get('/:key', getSettingByKey);

// Update routes require admin authentication
router.use(adminAuth);
router.put('/', updateGlobalSettings);
router.put('/:key', updateSettingByKey);
router.post('/reset', resetSettingsToDefault);

export default router;
