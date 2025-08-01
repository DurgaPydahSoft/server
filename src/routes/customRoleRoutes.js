import express from 'express';
import { 
  createCustomRole,
  getCustomRoles,
  getCustomRole,
  updateCustomRole,
  deleteCustomRole,
  getActiveCustomRoles
} from '../controllers/customRoleController.js';
import { superAdminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require super admin access
router.use(superAdminAuth);

// Custom role routes
router.post('/', createCustomRole);
router.get('/', getCustomRoles);
router.get('/active', getActiveCustomRoles);
router.get('/:id', getCustomRole);
router.put('/:id', updateCustomRole);
router.delete('/:id', deleteCustomRole);

export default router; 