import express from 'express';
import multer from 'multer';
import { adminAuth, authenticateStudent } from '../middleware/authMiddleware.js';
import {
  uploadStudents,
  addStudent,
  listStudents,
  editStudent,
  deleteStudent,
  updateProfile
} from '../controllers/studentController.js';
import { renewBatches } from '../controllers/adminController.js';

const router = express.Router();
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

export default router; 