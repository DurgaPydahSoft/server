const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const complaintRoutes = require('./complaintRoutes');
const memberRoutes = require('./memberRoutes');
const announcementRoutes = require('./announcementRoutes');

// Auth routes
router.use('/auth', authRoutes);

// Complaint routes
router.use('/complaints', complaintRoutes);

// Member management routes
router.use('/members', memberRoutes);

// Announcement routes
router.use('/announcements', announcementRoutes);

module.exports = router; 