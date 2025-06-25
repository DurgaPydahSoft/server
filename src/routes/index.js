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

export default router; 