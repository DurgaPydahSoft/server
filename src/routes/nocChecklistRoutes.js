import express from 'express';
import {
  getAllChecklistItems,
  getChecklistItem,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  reorderChecklistItems
} from '../controllers/nocChecklistController.js';
import { adminAuth } from '../middleware/authMiddleware.js';

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

// All routes require noc_management permission
router.get('/', nocManagementAuth, getAllChecklistItems);
router.get('/:id', nocManagementAuth, getChecklistItem);
router.post('/', nocManagementAuth, createChecklistItem);
router.put('/:id', nocManagementAuth, updateChecklistItem);
router.delete('/:id', nocManagementAuth, deleteChecklistItem);
router.post('/reorder', nocManagementAuth, reorderChecklistItems);

export default router;

