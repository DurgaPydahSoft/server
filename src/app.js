import memberRoutes from './routes/memberRoutes.js';
import pushSubscriptionRoutes from './routes/pushSubscriptionRoutes.js';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin/members', memberRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/push-subscriptions', pushSubscriptionRoutes); 