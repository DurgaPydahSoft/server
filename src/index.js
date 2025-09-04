import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';


// Import routes
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import adminManagementRoutes from './routes/adminManagementRoutes.js';
import courseManagementRoutes from './routes/courseManagementRoutes.js';
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
import attendanceRoutes from './routes/attendanceRoutes.js';
import foundLostRoutes from './routes/foundLostRoutes.js';
import feeReminderRoutes from './routes/feeReminderRoutes.js';
import feeStructureRoutes from './routes/feeStructureRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import apiRouter from './routes/index.js';
import { scheduleReminderProcessing } from './utils/feeReminderProcessor.js';
import Notification from './models/Notification.js';
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
      "http://192.168.3.186:3000",
      "https://18ae92c8dcb6.ngrok-free.app",
      "https://*.ngrok-free.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    allowedHeaders: [
      "Content-Type", 
      "Authorization", 
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control"
    ]
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
    "http://192.168.3.148:3000",
    "https://18ae92c8dcb6.ngrok-free.app",
    "https://*.ngrok-free.app"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type", 
    "Authorization", 
    "X-Requested-With",
    "Accept",
    "Origin",
    "Cache-Control"
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  preflightContinue: false,
  optionsSuccessStatus: 204
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    cashfreeUrl: 'https://api.cashfree.com/pg',
    hasCredentials: !!(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET),
    environment: process.env.NODE_ENV || 'development',
    jwtSecretConfigured: !!process.env.JWT_SECRET,
    corsOrigins: [
      "https://hostel-complaint-frontend.vercel.app",
      "http://localhost:5173",
      "http://localhost:3000",
      "https://hms.pydahsoft.in",
      "http://192.168.232.93:3000",
      "http://192.168.3.186:3000",
      "http://192.168.3.148:3000",
      "https://18ae92c8dcb6.ngrok-free.app",
      "https://*.ngrok-free.app"
    ],
    timestamp: new Date().toISOString()
  });
});

// Basic route for testing (no authentication required)
app.get('/', (req, res) => {
  console.log('🌐 Root endpoint accessed');
  res.json({ message: 'Welcome to Hostel Management System API' });
});


// API routes
app.use('/api', apiRouter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin-management', adminManagementRoutes);
app.use('/api/course-management', courseManagementRoutes);
app.use('/api/admin/members', memberRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/admin/rooms', roomRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/cafeteria/menu', menuRoutes);
app.use('/api/bulk-outing', bulkOutingRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/foundlost', foundLostRoutes);
app.use('/api/fee-reminders', feeReminderRoutes);
app.use('/api/fee-structures', feeStructureRoutes);
app.use('/api/payments', paymentRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('client/dist'));
  
  // Handle client-side routing (no authentication required)
  app.get('*', (req, res) => {
    console.log('🌐 Serving static file for:', req.path);
    res.sendFile(path.resolve(__dirname, '../client/dist/index.html'));
  });
}

// Error handling middleware
app.use(errorHandler);

// Import cleanup setup
import { setupMenuImageCleanup } from './utils/setupCleanup.js';

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Start fee reminder processing
  scheduleReminderProcessing();
  console.log('💰 Fee reminder processing scheduled');
  
  // Start menu image cleanup
  setupMenuImageCleanup();
  console.log('🧹 Menu image cleanup scheduled');
}); 
