import express from 'express';
import { 
  createSubAdmin,
  getSubAdmins,
  updateSubAdmin,
  deleteSubAdmin,
  adminLogin
} from '../controllers/adminManagementController.js';
import { adminAuth, superAdminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/login', adminLogin);

// Admin token validation endpoint
router.get('/validate', adminAuth, (req, res) => {
  console.log('🔐 Admin validation endpoint called');
  console.log('🔐 Admin data:', req.admin);
  if (!req.admin) {
    console.log('🔐 No admin found in request!');
    return res.status(401).json({ success: false, message: 'No admin found in request' });
  }
  res.json({
    success: true,
    data: {
      user: {
        id: req.admin._id,
        username: req.admin.username,
        role: req.admin.role,
        permissions: req.admin.permissions,
        isActive: req.admin.isActive
      }
    }
  });
});

// Protected routes - only super admin can access
router.use(superAdminAuth);
router.post('/sub-admins', createSubAdmin);
router.get('/sub-admins', getSubAdmins);
router.put('/sub-admins/:id', updateSubAdmin);
router.delete('/sub-admins/:id', deleteSubAdmin);

export default router; 