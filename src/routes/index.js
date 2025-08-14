import express from 'express';
import adminRoutes from './adminRoutes.js';
import studentRoutes from './studentRoutes.js';
import announcementRoutes from './announcementRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import roomRoutes from './roomRoutes.js';
import leaveRoutes from './leaveRoutes.js';
import adminManagementRoutes from './adminManagementRoutes.js';
import memberRoutes from './memberRoutes.js';
import complaintRoutes from './complaintRoutes.js';
import pollRoutes from './pollRoutes.js';
import menuRoutes from './menuRoutes.js';
import securitySettingsRoutes from './securitySettingsRoutes.js';
import attendanceRoutes from './attendanceRoutes.js';
import courseManagementRoutes from './courseManagementRoutes.js';
import feeReminderRoutes from './feeReminderRoutes.js';
import feeStructureRoutes from './feeStructureRoutes.js';
import featureToggleRoutes from './featureToggleRoutes.js';
import foundLostRoutes from './foundLostRoutes.js';
import principalRoutes from './principalRoutes.js';
import paymentRoutes from './paymentRoutes.js';

const router = express.Router();

router.use('/admin', adminRoutes);
router.use('/students', studentRoutes);
router.use('/announcements', announcementRoutes);
router.use('/notifications', notificationRoutes);
router.use('/rooms', roomRoutes);
router.use('/leave', leaveRoutes);
router.use('/admin-management', adminManagementRoutes);
router.use('/members', memberRoutes);
router.use('/complaints', complaintRoutes);

router.use('/polls', pollRoutes);
router.use('/menu', menuRoutes);
router.use('/security-settings', securitySettingsRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/course-management', courseManagementRoutes);
router.use('/fee-reminders', feeReminderRoutes);
router.use('/fee-structure', feeStructureRoutes);
router.use('/feature-toggles', featureToggleRoutes);
router.use('/foundlost', foundLostRoutes);
router.use('/principal', principalRoutes);
router.use('/payments', paymentRoutes);

export default router; 