const pushSubscriptionRoutes = require('./routes/pushSubscriptions');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/push-subscriptions', pushSubscriptionRoutes); 