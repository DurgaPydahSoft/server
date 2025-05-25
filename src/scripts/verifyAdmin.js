import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const verifyAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    
    // Find admin user
    const admin = await User.findOne({ role: 'admin' });
    
    if (!admin) {
      console.log('No admin user found in database');
      process.exit(1);
    }

    console.log('Admin user details:');
    console.log('-------------------');
    console.log('ID:', admin._id);
    console.log('Name:', admin.name);
    console.log('Roll Number:', admin.rollNumber);
    console.log('Role:', admin.role);
    
    // Test password
    const testPassword = 'admin123';
    const isMatch = await admin.comparePassword(testPassword);
    console.log('\nPassword verification:');
    console.log('---------------------');
    console.log('Test password (admin123) matches:', isMatch);
    
    // Show hashed password for verification
    console.log('\nHashed password in database:', admin.password);
    
    // Test JWT token generation
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    console.log('\nJWT Token test:');
    console.log('--------------');
    console.log('Token generated successfully:', !!token);
    console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
    
    process.exit(0);
  } catch (error) {
    console.error('Error verifying admin:', error);
    process.exit(1);
  }
};

verifyAdmin(); 