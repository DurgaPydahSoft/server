import express from 'express';
import { handlePrintRequest } from '../controllers/printController.js';
import { authenticatePrint } from '../middleware/printAuthentication.js';

const router = express.Router();

// Publicly exposed print endpoint secured via authentication middleware
router.post('/', authenticatePrint, handlePrintRequest);

export default router;
