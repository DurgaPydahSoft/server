import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
const dotenvResult = dotenv.config();
// if (dotenvResult.error) {
//   console.error('🔴 Error loading .env file:', dotenvResult.error);
// } else {
//   console.log('✅ .env file loaded successfully. Parsed variables:', Object.keys(dotenvResult.parsed || {}));
// }

// Import routes
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import adminManagementRoutes from './routes/adminManagementRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import complaintRoutes from './routes/complaintRoutes.js';
import announcementRoutes from './routes/announcementRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import memberRoutes from './routes/memberRoutes.js';
import pollRoutes from './routes/pollRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import leaveRoutes from './routes/leaveRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import bulkOutingRoutes from './routes/bulkOutingRoutes.js';
import apiRouter from './routes/index.js';
// Import Notification model
import Notification from './models/Notification.js';
// Import error handler
import { errorHandler } from './utils/error.js';





// Create Express app
const app = express();
const httpServer = createServer(app);

// Socket.io setup
const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "https://hostel-complaint-frontend.vercel.app",
      "http://localhost:5173",
      "https://hms.pydahsoft.in",
      "http://192.168.3.148:3000",
      "http://192.168.3.186:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

// Middleware
app.use(cors({
  origin: [
    "https://hostel-complaint-frontend.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "https://hms.pydahsoft.in",
    "http://192.168.232.93:3000",
    "http://192.168.3.186:3000",
    "http://192.168.3.148:3000"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Range", "X-Content-Range"]
}));

// Add pre-flight OPTIONS handler
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management')
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Socket.io connection handling
io.on('connection', (socket) => {
  // Attach userId to socket for targeted notifications
  socket.on('register', (userId) => {
    socket.join(userId);
  });
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Helper to emit notification
Notification.watch().on('change', async (change) => {
  if (change.operationType === 'insert') {
    const notification = change.fullDocument;
    io.to(notification.recipient.toString()).emit('notification', {
      title: notification.title,
      message: notification.message,
      type: notification.type,
      createdAt: notification.createdAt,
    });
  }
});

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Hostel Management System API' });
});

// Test route for leave API
app.get('/test-leave/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Testing leave route with ID:', id);
    res.json({ 
      message: 'Test route working', 
      id: id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test route for notification system
app.get('/test-notification', async (req, res) => {
  try {
    console.log('🔔 Testing notification system...');
    
    // Import the notification service
    const notificationService = (await import('./utils/notificationService.js')).default;
    
    const status = notificationService.getStatus();
    
    res.json({ 
      message: 'Notification system test', 
      status: status,
      timestamp: new Date().toISOString(),
      oneSignalConfigured: !!process.env.ONESIGNAL_APP_ID
    });
  } catch (error) {
    console.error('🔔 Notification test error:', error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test OneSignal connection endpoint
app.get('/test-onesignal', async (req, res) => {
  try {
    const { testOneSignalConnection } = await import('./utils/oneSignalService.js');
    const result = await testOneSignalConnection();
    
    res.json({
      success: true,
      message: 'OneSignal connection test completed',
      result
    });
  } catch (error) {
    console.error('Error testing OneSignal connection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test OneSignal connection',
      error: error.message
    });
  }
});

// Test notification endpoint with detailed logging
app.post('/test-push-notification', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    console.log('🔔 Testing push notification for user:', userId);

    const { sendOneSignalNotification } = await import('./utils/oneSignalService.js');
    
    const testNotification = {
      title: 'Test Push Notification',
      message: 'This is a test push notification from the server',
      type: 'system',
      url: '/',
      priority: 10,
      data: {
        test: true,
        timestamp: new Date().toISOString()
      }
    };

    console.log('🔔 Sending test notification with payload:', testNotification);

    const result = await sendOneSignalNotification(userId, testNotification);
    
    if (result) {
      console.log('🔔 Test push notification sent successfully');
      res.json({
        success: true,
        message: 'Test push notification sent successfully',
        notification: testNotification
      });
    } else {
      console.log('🔔 Test push notification failed');
      res.status(500).json({
        success: false,
        message: 'Failed to send test push notification'
      });
    }
  } catch (error) {
    console.error('🔔 Error sending test push notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test push notification',
      error: error.message
    });
  }
});

// API routes
app.use('/api', apiRouter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin-management', adminManagementRoutes);
app.use('/api/admin/members', memberRoutes);
app.use('/api/leave', leaveRoutes); 
app.use('/api/admin/rooms', roomRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/bulk-outing', bulkOutingRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('client/dist'));
  
  // Handle client-side routing
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../client/dist/index.html'));
  });
}

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 
