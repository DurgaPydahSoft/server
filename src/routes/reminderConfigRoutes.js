import express from 'express';
import { body, param } from 'express-validator';
import {
  getReminderConfig,
  updateReminderConfig,
  testReminder,
  resetReminderConfig,
  getTermDueDateConfigs,
  updateTermDueDateConfig,
  getTermDueDateConfig,
  calculateTermDueDates,
  recalculateAllReminderDates,
  deleteTermDueDateConfig,
  processLateFees
} from '../controllers/reminderConfigController.js';
import { adminAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Validation middleware
const validateReminderConfig = [
  body('preReminders').isObject().withMessage('Pre reminders must be an object'),
  body('preReminders.email').isObject().withMessage('Pre email reminders must be an object'),
  body('preReminders.email.enabled').isBoolean().withMessage('Pre email enabled must be boolean'),
  body('preReminders.email.daysBeforeDue').isArray().withMessage('Pre email days before due must be an array'),
  body('preReminders.email.daysBeforeDue.*').isInt({ min: 1, max: 365 }).withMessage('Days before due must be between 1 and 365'),
  body('preReminders.push').isObject().withMessage('Pre push reminders must be an object'),
  body('preReminders.push.enabled').isBoolean().withMessage('Pre push enabled must be boolean'),
  body('preReminders.push.daysBeforeDue').isArray().withMessage('Pre push days before due must be an array'),
  body('preReminders.push.daysBeforeDue.*').isInt({ min: 1, max: 365 }).withMessage('Days before due must be between 1 and 365'),
  body('preReminders.sms').isObject().withMessage('Pre SMS reminders must be an object'),
  body('preReminders.sms.enabled').isBoolean().withMessage('Pre SMS enabled must be boolean'),
  body('preReminders.sms.daysBeforeDue').isArray().withMessage('Pre SMS days before due must be an array'),
  body('preReminders.sms.daysBeforeDue.*').isInt({ min: 1, max: 365 }).withMessage('Days before due must be between 1 and 365'),
  
  body('postReminders').isObject().withMessage('Post reminders must be an object'),
  body('postReminders.email').isObject().withMessage('Post email reminders must be an object'),
  body('postReminders.email.enabled').isBoolean().withMessage('Post email enabled must be boolean'),
  body('postReminders.email.daysAfterDue').isArray().withMessage('Post email days after due must be an array'),
  body('postReminders.email.daysAfterDue.*').isInt({ min: 1, max: 365 }).withMessage('Days after due must be between 1 and 365'),
  body('postReminders.push').isObject().withMessage('Post push reminders must be an object'),
  body('postReminders.push.enabled').isBoolean().withMessage('Post push enabled must be boolean'),
  body('postReminders.push.daysAfterDue').isArray().withMessage('Post push days after due must be an array'),
  body('postReminders.push.daysAfterDue.*').isInt({ min: 1, max: 365 }).withMessage('Days after due must be between 1 and 365'),
  body('postReminders.sms').isObject().withMessage('Post SMS reminders must be an object'),
  body('postReminders.sms.enabled').isBoolean().withMessage('Post SMS enabled must be boolean'),
  body('postReminders.sms.daysAfterDue').isArray().withMessage('Post SMS days after due must be an array'),
  body('postReminders.sms.daysAfterDue.*').isInt({ min: 1, max: 365 }).withMessage('Days after due must be between 1 and 365'),
  
  body('autoReminders').isObject().withMessage('Auto reminders must be an object'),
  body('autoReminders.enabled').isBoolean().withMessage('Auto reminders enabled must be boolean'),
  body('autoReminders.frequency').isIn(['daily', 'weekly', 'monthly']).withMessage('Frequency must be daily, weekly, or monthly'),
  body('autoReminders.maxPreReminders').isInt({ min: 1, max: 10 }).withMessage('Max pre reminders must be between 1 and 10'),
  body('autoReminders.maxPostReminders').isInt({ min: 1, max: 10 }).withMessage('Max post reminders must be between 1 and 10')
];

const validateTestReminder = [
  param('section').isIn(['pre', 'post']).withMessage('Section must be "pre" or "post"'),
  param('type').isIn(['email', 'push', 'sms']).withMessage('Type must be "email", "push", or "sms"'),
  body('testEmail').optional().isEmail().withMessage('Test email must be valid'),
  body('testMessage').optional().isString().isLength({ min: 1, max: 500 }).withMessage('Test message must be between 1 and 500 characters')
];

// Routes

// GET /api/reminder-config - Get reminder configuration
router.get('/', adminAuth, getReminderConfig);

// PUT /api/reminder-config - Update reminder configuration
router.put('/', adminAuth, validateReminderConfig, updateReminderConfig);

// POST /api/reminder-config/test/:section/:type - Test reminder functionality
router.post('/test/:section/:type', adminAuth, validateTestReminder, testReminder);

// POST /api/reminder-config/reset - Reset configuration to defaults
router.post('/reset', adminAuth, resetReminderConfig);

// Term Due Date Configuration Routes

// GET /api/reminder-config/term-due-dates - Get all term due date configurations
router.get('/term-due-dates', adminAuth, getTermDueDateConfigs);

// PUT /api/reminder-config/term-due-dates - Add or update term due date configuration
router.put('/term-due-dates', adminAuth, [
  body('courseId').isMongoId().withMessage('Valid course ID is required'),
  body('academicYear').matches(/^\d{4}-\d{4}$/).withMessage('Academic year must be in format YYYY-YYYY'),
  body('yearOfStudy').isInt({ min: 1, max: 10 }).withMessage('Year of study must be between 1 and 10'),
  body('termDueDates').isObject().withMessage('Term due dates must be an object'),
  body('termDueDates.term1').isObject().withMessage('Term 1 due date must be an object'),
  body('termDueDates.term1.daysFromSemesterStart').isInt({ min: 1, max: 365 }).withMessage('Term 1 days from semester start must be between 1 and 365'),
  body('termDueDates.term2').isObject().withMessage('Term 2 due date must be an object'),
  body('termDueDates.term2.daysFromSemesterStart').isInt({ min: 1, max: 365 }).withMessage('Term 2 days from semester start must be between 1 and 365'),
  body('termDueDates.term3').isObject().withMessage('Term 3 due date must be an object'),
  body('termDueDates.term3.daysFromSemesterStart').isInt({ min: 1, max: 365 }).withMessage('Term 3 days from semester start must be between 1 and 365'),
  body('reminderDays').isObject().withMessage('Reminder days must be an object'),
  body('reminderDays.term1').isObject().withMessage('Term 1 reminder days must be an object'),
  body('reminderDays.term1.preReminders').isArray().withMessage('Term 1 pre reminders must be an array'),
  body('reminderDays.term1.postReminders').isArray().withMessage('Term 1 post reminders must be an array'),
  body('reminderDays.term2').isObject().withMessage('Term 2 reminder days must be an object'),
  body('reminderDays.term2.preReminders').isArray().withMessage('Term 2 pre reminders must be an array'),
  body('reminderDays.term2.postReminders').isArray().withMessage('Term 2 post reminders must be an array'),
  body('reminderDays.term3').isObject().withMessage('Term 3 reminder days must be an object'),
  body('reminderDays.term3.preReminders').isArray().withMessage('Term 3 pre reminders must be an array'),
  body('reminderDays.term3.postReminders').isArray().withMessage('Term 3 post reminders must be an array')
], updateTermDueDateConfig);

// GET /api/reminder-config/term-due-dates/:courseId/:academicYear/:yearOfStudy - Get specific term due date configuration
router.get('/term-due-dates/:courseId/:academicYear/:yearOfStudy', adminAuth, [
  param('courseId').isMongoId().withMessage('Valid course ID is required'),
  param('academicYear').matches(/^\d{4}-\d{4}$/).withMessage('Academic year must be in format YYYY-YYYY'),
  param('yearOfStudy').isInt({ min: 1, max: 10 }).withMessage('Year of study must be between 1 and 10')
], getTermDueDateConfig);

// POST /api/reminder-config/term-due-dates/:courseId/:academicYear/:yearOfStudy/calculate - Calculate term due dates
router.post('/term-due-dates/:courseId/:academicYear/:yearOfStudy/calculate', adminAuth, [
  param('courseId').isMongoId().withMessage('Valid course ID is required'),
  param('academicYear').matches(/^\d{4}-\d{4}$/).withMessage('Academic year must be in format YYYY-YYYY'),
  param('yearOfStudy').isInt({ min: 1, max: 10 }).withMessage('Year of study must be between 1 and 10'),
  body('semesterStartDate').isISO8601().withMessage('Valid semester start date is required')
], calculateTermDueDates);

// POST /api/reminder-config/recalculate-dates - Recalculate all reminder dates
router.post('/recalculate-dates', adminAuth, recalculateAllReminderDates);

// DELETE /api/reminder-config/term-due-dates/:courseId/:academicYear/:yearOfStudy - Delete term due date configuration
router.delete('/term-due-dates/:courseId/:academicYear/:yearOfStudy', adminAuth, [
  param('courseId').isMongoId().withMessage('Valid course ID is required'),
  param('academicYear').matches(/^\d{4}-\d{4}$/).withMessage('Academic year must be in format YYYY-YYYY'),
  param('yearOfStudy').isInt({ min: 1, max: 10 }).withMessage('Year of study must be between 1 and 10')
], deleteTermDueDateConfig);

// POST /api/reminder-config/process-late-fees - Process late fees for all students
router.post('/process-late-fees', adminAuth, processLateFees);

export default router;