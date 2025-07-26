import express from 'express';
import { getStudentsByPrincipalCourse } from '../controllers/adminController.js';
import { principalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require principal authentication
router.use(principalAuth);

// Get students by principal's assigned course
router.get('/students', getStudentsByPrincipalCourse);

export default router; 