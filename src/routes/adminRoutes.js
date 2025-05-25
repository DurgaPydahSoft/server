import express from 'express';
import { 
  addStudent,
  getStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getBranchesByCourse,
  bulkAddStudents,
  getTempStudentsSummary,
  getStudentsCount
} from '../controllers/adminController.js';
import { adminAuth } from '../middleware/authMiddleware.js';
import multer from 'multer';

const router = express.Router();

// Setup multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx and .xls files are allowed!'), false);
    }
  }
});

// All routes require admin authentication
router.use(adminAuth);

// Student management routes
// Specific sub-paths of /students/ should come before dynamic /students/:id

// New route for bulk student upload
router.post('/students/bulk-upload', upload.single('file'), bulkAddStudents);

// New route to get temporary students for admin dashboard
router.get('/students/temp-summary', getTempStudentsSummary);

// New route to get total student count
router.get('/students/count', getStudentsCount);

// Routes for /students (exact path)
router.post('/students', addStudent);
router.get('/students', getStudents);

// Dynamic routes for /students/:id
router.get('/students/:id', getStudentById);
router.put('/students/:id', updateStudent);
router.delete('/students/:id', deleteStudent);

// Utility routes
router.get('/branches/:course', getBranchesByCourse);

export default router; 