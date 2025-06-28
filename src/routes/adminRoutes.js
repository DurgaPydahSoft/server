import express from 'express';
import { 
  addStudent,
  getStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getBranchesByCourse,
  getTempStudentsSummary,
  getStudentsCount,
  addElectricityBill,
  getElectricityBills,
  previewBulkUpload,
  bulkAddStudents,
  clearTempStudents,
  renewBatches,
  searchStudentByRollNumber,
  resetStudentPassword
} from '../controllers/adminController.js';
import { 
  getAllLeaveRequests,
  verifyOTPAndApprove,
  rejectLeaveRequest
} from '../controllers/leaveController.js';
import { adminAuth, wardenAuth } from '../middleware/authMiddleware.js';
import { testEmailService, getEmailServiceStatus } from '../utils/emailService.js';
import multer from 'multer';

const router = express.Router();

// Setup multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed!'), false);
    }
  }
});

// Setup multer for image uploads
const imageUpload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Public search route for security dashboard
router.get('/students/search/:rollNumber', searchStudentByRollNumber);

// Warden routes for viewing students (read-only)
router.get('/warden/students', wardenAuth, getStudents);

// All routes below require admin authentication
router.use(adminAuth);

// Email service routes
router.get('/email/status', (req, res) => {
  const status = getEmailServiceStatus();
  res.json({
    success: true,
    data: status
  });
});

router.post('/email/test', async (req, res) => {
  try {
    const { testEmail } = req.body;
    
    if (!testEmail) {
      return res.status(400).json({
        success: false,
        message: 'Test email address is required'
      });
    }

    const result = await testEmailService(testEmail);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test email sent successfully',
        data: result
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send test email',
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error testing email service',
      error: error.message
    });
  }
});

// Leave management routes
router.get('/leave/all', getAllLeaveRequests);
router.post('/leave/verify-otp', verifyOTPAndApprove);
router.post('/leave/reject', rejectLeaveRequest);

// Student management routes
// Specific sub-paths of /students/ should come before dynamic /students/:id

// New route for bulk student upload preview
router.post('/students/bulk-upload-preview', upload.single('file'), previewBulkUpload);

// New route for bulk student upload commit
router.post('/students/bulk-upload-commit', bulkAddStudents);

// New route to get temporary students for admin dashboard
router.get('/students/temp-summary', getTempStudentsSummary);

// New route to get total student count
router.get('/students/count', getStudentsCount);

// New route for renewing student batches
router.post('/students/renew-batch', renewBatches);

// Routes for /students (exact path)
router.post('/students', imageUpload.fields([
  { name: 'studentPhoto', maxCount: 1 },
  { name: 'guardianPhoto1', maxCount: 1 },
  { name: 'guardianPhoto2', maxCount: 1 }
]), addStudent);
router.get('/students', getStudents);

// Specific sub-paths of /students/ should come before dynamic /students/:id
router.delete('/students/temp-clear', clearTempStudents);

// Dynamic routes for /students/:id
router.get('/students/:id', getStudentById);
router.put('/students/:id', imageUpload.fields([
  { name: 'studentPhoto', maxCount: 1 },
  { name: 'guardianPhoto1', maxCount: 1 },
  { name: 'guardianPhoto2', maxCount: 1 }
]), updateStudent);
router.delete('/students/:id', deleteStudent);

// Admin password reset for students
router.post('/students/:id/reset-password', resetStudentPassword);

// Utility routes
router.get('/branches/:course', getBranchesByCourse);

// Electricity bill routes
router.post('/rooms/:roomId/electricity', addElectricityBill);
router.get('/rooms/:roomId/electricity', getElectricityBills);

export default router; 