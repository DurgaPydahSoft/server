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
  getCourseCounts,
  addElectricityBill,
  getElectricityBills,
  previewBulkUpload,
  bulkAddStudents,
  clearTempStudents,
  renewBatches,
  searchStudentByRollNumber,
  resetStudentPassword,
  updateStudentYears,
  updateStudentYearsFromAcademicCalendar,
  getStudentsForAdmitCards,
  generateAdmitCard,
  generateBulkAdmitCards,
  getRoomBedLockerAvailability,
  getStudentTempPassword,
  shareStudentCredentials,
  getConcessionApprovals,
  getApprovedConcessions,
  approveConcession,
  rejectConcession
} from '../controllers/adminController.js';
import {
  addStaffGuest,
  getStaffGuests,
  getStaffGuestById,
  updateStaffGuest,
  deleteStaffGuest,
  checkInOutStaffGuest,
  getStaffGuestStats,
  getDailyRateSettings,
  updateDailyRateSettings,
  generateAdmitCard as generateStaffGuestAdmitCard,
  renewMonthlyStaff
} from '../controllers/staffGuestController.js';
import {
  getStaffForAttendance,
  takeStaffAttendance,
  getStaffAttendanceForDate,
  getStaffAttendanceForDateRange,
  getStaffAttendanceStats,
  updateStaffAttendance,
  deleteStaffAttendance,
  getStaffCount
} from '../controllers/staffAttendanceController.js';
import { initializeHostelCounters, getCounterStatus } from '../utils/initializeCounters.js';
import { 
  getAllLeaveRequests,
  verifyOTPAndApprove,
  rejectLeaveRequest
} from '../controllers/leaveController.js';
import { adminAuth, wardenAuth, superAdminAuth, checkPermission } from '../middleware/authMiddleware.js';

// Middleware for concession management permission
const concessionManagementAuth = [adminAuth, (req, res, next) => {
  // Super admin always has access
  if (req.admin?.role === 'super_admin') {
    return next();
  }
  
  // Check if user has concession_management permission
  if (req.admin?.permissions?.includes('concession_management')) {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied. You need concession_management permission.'
  });
}];
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
// Increased limit to 10MB per file to handle high-quality photos
// Total request can be up to 30MB (student + 2 guardians = 3 images)
const imageUpload = multer({
  storage: storage,
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB per file
    fieldSize: 10 * 1024 * 1024, // 10MB for other fields
    files: 3 // Maximum 3 files (student photo + 2 guardian photos)
  },
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

// Admin root route (no authentication required for basic info)
router.get(['/', ''], (req, res) => {
  console.log('--- ADMIN ROOT ROUTE ACCESSED ---');
  console.log('Method:', req.method);
  console.log('Path:', req.originalUrl);
  console.log('Headers:', req.headers);
  console.log('Cookies:', req.cookies);
  console.log('User:', req.user);
  res.json({ 
    message: 'Admin API endpoint',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

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

// New route to get course counts
router.get('/students/course-counts', getCourseCounts);

// New route for renewing student batches
router.post('/students/renew-batch', renewBatches);

// New route for updating student years based on batch
router.post('/students/update-years', updateStudentYears);
router.post('/students/update-years-academic-calendar', updateStudentYearsFromAcademicCalendar);

// Routes for /students (exact path)
router.post('/students', imageUpload.fields([
  { name: 'studentPhoto', maxCount: 1 },
  { name: 'guardianPhoto1', maxCount: 1 },
  { name: 'guardianPhoto2', maxCount: 1 }
]), addStudent);
router.get('/students', getStudents);

// Specific sub-paths of /students/ should come before dynamic /students/:id
router.delete('/students/temp-clear', clearTempStudents);

// Admit card routes (must come before dynamic /students/:id routes)
router.get('/students/admit-cards', getStudentsForAdmitCards);
router.post('/students/bulk-admit-cards', generateBulkAdmitCards);

// Concession approval routes - must come before dynamic /students/:id routes
router.get('/students/concession-approvals', concessionManagementAuth, getConcessionApprovals);
router.get('/students/approved-concessions', concessionManagementAuth, getApprovedConcessions);

// Password fetching routes (must come before dynamic /students/:id routes)
router.get('/students/:id/temp-password', getStudentTempPassword);

// Dynamic routes for /students/:id
router.get('/students/:id', getStudentById);
router.post('/students/:id/admit-card', generateAdmitCard);
router.put('/students/:id', imageUpload.fields([
  { name: 'studentPhoto', maxCount: 1 },
  { name: 'guardianPhoto1', maxCount: 1 },
  { name: 'guardianPhoto2', maxCount: 1 }
]), updateStudent);
router.delete('/students/:id', deleteStudent);

// Admin password reset for students
router.post('/students/:id/reset-password', resetStudentPassword);

// Share student credentials via SMS
router.post('/students/share-credentials', shareStudentCredentials);

// Concession approval action routes
router.post('/students/:id/approve-concession', concessionManagementAuth, approveConcession);
router.post('/students/:id/reject-concession', concessionManagementAuth, rejectConcession);

// Utility routes
router.get('/branches/:course', getBranchesByCourse);

// Hostel ID counter management routes
router.post('/counters/initialize', async (req, res) => {
  try {
    const result = await initializeHostelCounters();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/counters/status', async (req, res) => {
  try {
    const counters = await getCounterStatus();
    res.json({ success: true, counters });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Electricity bill routes
router.post('/rooms/:roomId/electricity', addElectricityBill);
router.get('/rooms/:roomId/electricity', getElectricityBills);

// Room bed/locker availability route
router.get('/rooms/:roomNumber/bed-locker-availability', getRoomBedLockerAvailability);

// Staff/Guests management routes
router.post('/staff-guests', imageUpload.single('photo'), addStaffGuest);
router.get('/staff-guests', getStaffGuests);
router.get('/staff-guests/stats', getStaffGuestStats);
router.get('/staff-guests/:id', getStaffGuestById);
router.put('/staff-guests/:id', imageUpload.single('photo'), updateStaffGuest);
router.delete('/staff-guests/:id', deleteStaffGuest);
router.post('/staff-guests/:id/checkin-out', checkInOutStaffGuest);
router.post('/staff-guests/:id/renew', renewMonthlyStaff);

// Staff Attendance management routes
router.get('/staff-attendance', getStaffAttendanceForDate);
router.get('/staff-attendance/stats', getStaffAttendanceStats);
router.get('/staff-attendance/range', getStaffAttendanceForDateRange);
router.post('/staff-attendance', takeStaffAttendance);
router.put('/staff-attendance', updateStaffAttendance);
router.delete('/staff-attendance/:staffId/:date', deleteStaffAttendance);
router.get('/staff-attendance/count', getStaffCount);

// Staff/Guest Settings and Admit Card routes
router.get('/staff-guests/settings/daily-rates', getDailyRateSettings);
router.put('/staff-guests/settings/daily-rates', updateDailyRateSettings);
router.get('/staff-guests/:id/admit-card', generateStaffGuestAdmitCard);

export default router; 