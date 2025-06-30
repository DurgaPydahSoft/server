import express from 'express';
import { 
  createSubAdmin,
  getSubAdmins,
  updateSubAdmin,
  deleteSubAdmin,
  createWarden,
  getWardens,
  updateWarden,
  deleteWarden,
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
  
  // Prepare user response data
  const userResponse = {
    id: req.admin._id,
    username: req.admin.username,
    role: req.admin.role,
    permissions: req.admin.permissions,
    isActive: req.admin.isActive
  };

  // Include hostelType for wardens
  if (req.admin.role === 'warden' && req.admin.hostelType) {
    userResponse.hostelType = req.admin.hostelType;
  }

  res.json({
    success: true,
    data: {
      user: userResponse
    }
  });
});

// Protected routes - only super admin can access
router.use(superAdminAuth);

// Sub-admin routes
router.post('/sub-admins', createSubAdmin);
router.get('/sub-admins', getSubAdmins);
router.put('/sub-admins/:id', updateSubAdmin);
router.delete('/sub-admins/:id', deleteSubAdmin);

// Warden routes
router.post('/wardens', createWarden);
router.get('/wardens', getWardens);
router.put('/wardens/:id', updateWarden);
router.delete('/wardens/:id', deleteWarden);

export default router; 