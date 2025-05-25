import express from 'express';
import { adminAuth, authenticateStudent } from '../middleware/authMiddleware.js';
import {
  createAnnouncement,
  listAnnouncements,
  deleteAnnouncement,
  listAllAnnouncements
} from '../controllers/announcementController.js';
import multer from 'multer';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload only images.'), false);
    }
  },
});

// Routes
router.post('/', adminAuth, upload.single('image'), createAnnouncement);
router.get('/', authenticateStudent, listAnnouncements);
router.get('/admin/all', adminAuth, listAllAnnouncements);
router.delete('/:id', adminAuth, deleteAnnouncement);

export default router; 