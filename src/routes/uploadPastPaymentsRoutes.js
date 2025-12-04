import express from 'express';
import multer from 'multer';
import { previewPastPayments, uploadPastPayments } from '../controllers/uploadPastPaymentsController.js';

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

// Preview past payments from Excel (public route - no auth required)
router.post('/preview', upload.single('file'), previewPastPayments);

// Upload past payments from Excel (public route - no auth required)
router.post('/upload', upload.single('file'), uploadPastPayments);

export default router;




