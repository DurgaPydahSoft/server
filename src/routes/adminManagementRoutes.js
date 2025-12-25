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
  createPrincipal,
  getPrincipals,
  updatePrincipal,
  deletePrincipal,
  adminLogin,
  resetAdminPassword
} from '../controllers/adminManagementController.js';
import { adminAuth, superAdminAuth } from '../middleware/authMiddleware.js';
import customRoleRoutes from './customRoleRoutes.js';

const router = express.Router();

// Public routes
router.post('/login', adminLogin);

// Admin token validation endpoint
router.get('/validate', adminAuth, async (req, res) => {
  console.log('🔐 Admin validation endpoint called');
  console.log('🔐 Admin data:', req.admin);
  if (!req.admin) {
    console.log('🔐 No admin found in request!');
    return res.status(401).json({ success: false, message: 'No admin found in request' });
  }
  
  try {
    // Populate course for principals
    let adminData = req.admin;
    if (req.admin.role === 'principal' && req.admin.course) {
      const Admin = (await import('../models/Admin.js')).default;
      adminData = await Admin.findById(req.admin._id).populate('course', 'name code');
    }

    // Populate custom role for custom role admins
    if (req.admin.role === 'custom' && req.admin.customRoleId) {
      const Admin = (await import('../models/Admin.js')).default;
      adminData = await Admin.findById(req.admin._id).populate('customRoleId', 'name description permissions permissionAccessLevels courseAssignment assignedCourses');
    }
    
    // Prepare user response data
    const userResponse = {
      id: adminData._id,
      username: adminData.username,
      role: adminData.role,
      permissions: adminData.permissions,
      permissionAccessLevels: adminData.permissionAccessLevels,
      isActive: adminData.isActive
    };

    // Include hostelType for wardens
    if (adminData.role === 'warden' && adminData.hostelType) {
      userResponse.hostelType = adminData.hostelType;
    }

    // Include course for principals
    if (adminData.role === 'principal') {
      if (adminData.course) userResponse.course = adminData.course;
      if (adminData.assignedCourses && adminData.assignedCourses.length > 0) {
        userResponse.assignedCourses = adminData.assignedCourses;
      }
    }

    // Include custom role info for custom role admins
    if (adminData.role === 'custom' && adminData.customRoleId) {
      userResponse.customRoleId = adminData.customRoleId;
      userResponse.customRole = adminData.customRole;
    }

    res.json({
      success: true,
      data: {
        user: userResponse
      }
    });
  } catch (error) {
    console.error('🔐 Error in admin validation:', error);
    res.status(500).json({ success: false, message: 'Validation error' });
  }
});

// Password reset route for admins (sub-admins and principals) - accessible by all admins
router.post('/reset-password', adminAuth, resetAdminPassword);

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

// Principal routes
router.post('/principals', createPrincipal);
router.get('/principals', getPrincipals);
router.put('/principals/:id', updatePrincipal);
router.delete('/principals/:id', deletePrincipal);

// Custom role routes
router.use('/custom-roles', customRoleRoutes);

export default router; 