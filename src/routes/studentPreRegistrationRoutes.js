import express from 'express';
import multer from 'multer';
import { adminAuth } from '../middleware/authMiddleware.js';
import {
  submitPreRegistration,
  getPreRegistrations,
  getPreRegistrationById,
  approvePreRegistration,
  rejectPreRegistration,
  deletePreRegistration
} from '../controllers/studentPreRegistrationController.js';

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

// Public routes (no authentication required)
router.post('/preregister', imageUpload.fields([
  { name: 'studentPhoto', maxCount: 1 },
  { name: 'guardianPhoto1', maxCount: 1 },
  { name: 'guardianPhoto2', maxCount: 1 }
]), submitPreRegistration);

// Admin routes (authentication required)
router.get('/preregistrations', adminAuth, getPreRegistrations);
router.get('/preregistrations/:id', adminAuth, getPreRegistrationById);
router.post('/preregistrations/:id/approve', adminAuth, approvePreRegistration);
router.post('/preregistrations/:id/reject', adminAuth, rejectPreRegistration);
router.delete('/preregistrations/:id', adminAuth, deletePreRegistration);

export default router;
