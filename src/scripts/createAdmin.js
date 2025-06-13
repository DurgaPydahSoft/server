import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

// Load environment variables
dotenv.config();

const createAdmin = async () => {
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
    
    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log('Admin user already exists');
      process.exit(0);
    }

    // Create admin user with minimal required fields
    const admin = new User({
      name: 'Admin',
      rollNumber: 'ADMIN',
      password: process.env.ADMIN_PASSWORD || 'admin123',
      role: 'admin',
      // Add dummy values for student-specific fields to satisfy schema
      course: 'B.Tech',
      year: 1,
      branch: 'CSE',
      gender: 'Male',
      category: 'A',
      roomNumber: '302',
      studentPhone: '1234567890',
      parentPhone: '1234567890',
      batch: '2024-2028'
    });

    // Skip validation for admin creation
    admin.$ignore('course', 'year', 'branch', 'gender', 'category', 'roomNumber', 'studentPhone', 'parentPhone', 'batch');

    await admin.save();
    console.log('Admin user created successfully');
    console.log('Default credentials:');
    console.log('Username: ADMIN');
    console.log('Password: admin123');
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
};

createAdmin(); 