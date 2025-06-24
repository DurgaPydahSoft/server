import express from 'express';
import multer from 'multer';
import { adminAuth, authenticateStudent } from '../middleware/authMiddleware.js';
import {
  uploadStudents,
  addStudent,
  listStudents,
  editStudent,
  deleteStudent,
  updateProfile,
  updateProfilePhotos
} from '../controllers/studentController.js';
import { renewBatches } from '../controllers/adminController.js';

const router = express.Router();

// Setup multer for image uploads
const storage = multer.memoryStorage();
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

const upload = multer({ dest: 'uploads/' });

// Upload students via Excel
router.post('/upload', adminAuth, upload.single('file'), uploadStudents);
// Manual add
router.post('/add', adminAuth, addStudent);
// List all
router.get('/', adminAuth, listStudents);
// Renew Batches
router.post('/renew-batch', adminAuth, renewBatches);
// Edit
router.put('/:id', adminAuth, editStudent);
// Delete
router.delete('/:id', adminAuth, deleteStudent);

// Update profile
router.put('/profile', authenticateStudent, updateProfile);

// Update profile photos
router.put('/profile/photos', authenticateStudent, imageUpload.fields([
  { name: 'studentPhoto', maxCount: 1 },
  { name: 'guardianPhoto1', maxCount: 1 },
  { name: 'guardianPhoto2', maxCount: 1 }
]), updateProfilePhotos);

export default router; 