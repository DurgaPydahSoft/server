import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from '../models/Admin.js';

// Load environment variables
dotenv.config();

const createSuperAdmin = async () => {
  try {
    // Connect to MongoDB with retry logic
    const connectWithRetry = async () => {
      try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel_complaint_db');
        console.log('Connected to MongoDB');
      } catch (err) {
        console.log('MongoDB connection error. Retrying in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    await connectWithRetry();
    
    // Check if super admin already exists
    const existingSuperAdmin = await Admin.findOne({ role: 'super_admin' });
    if (existingSuperAdmin) {
      console.log('Super admin already exists');
      console.log('Username:', existingSuperAdmin.username);
      process.exit(0);
    }

    // Create super admin with all permissions
    const superAdmin = new Admin({
      username: 'superadmin',
      password: process.env.SUPER_ADMIN_PASSWORD || 'superadmin123',
      role: 'super_admin',
      permissions: [
        'dashboard_home',
        'room_management',
        'student_management',
        'maintenance_ticket_management',
        'leave_management',
        'announcement_management',
        'poll_management',
        'menu_management',
        'course_management',
        'attendance_management',
        'found_lost_management',
        'fee_management',
        'feature_controls',
        'security_management'
      ],
      isActive: true
    });

    await superAdmin.save();
    console.log('Super admin created successfully');
    console.log('Default credentials:');
    console.log('Username: superadmin');
    console.log('Password: superadmin123');
    console.log('Role: super_admin');
    console.log('Permissions: All permissions granted with full access');
    console.log('Note: The pre-save hook will automatically set all permissions to full access level');
    process.exit(0);
  } catch (error) {
    console.error('Error creating super admin:', error);
    process.exit(1);
  }
};

createSuperAdmin(); 