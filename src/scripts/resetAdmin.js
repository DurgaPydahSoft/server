import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

const resetAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    
    // Delete existing admin if any
    await User.deleteOne({ role: 'admin' });
    
    // Create new admin user
    const admin = new User({
      name: 'Admin',
      rollNumber: 'ADMIN',
      password: 'admin123', // This will be hashed by the pre-save hook
      role: 'admin'
    });

    await admin.save();
    console.log('Admin user reset successfully');
    console.log('Username: ADMIN');
    console.log('Password: admin123');
    process.exit(0);
  } catch (error) {
    console.error('Error resetting admin:', error);
    process.exit(1);
  }
};

resetAdmin(); 