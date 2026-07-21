import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from '../models/Admin.js';

dotenv.config();

const resetAdmin = async () => {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management'
    );

    // Delete existing super admin with the same username
    await Admin.deleteOne({ username: 'superadmin' });

    // Create new super admin
    const admin = new Admin({
      username: 'superadmin',
      name: 'Super Admin',
      password: 'superadmin123',
      role: 'super_admin',
      isActive: true
    });

    await admin.save();

    console.log('Super admin reset successfully');
    console.log('Username: superadmin');
    console.log('Password: superadmin123');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error resetting super admin:', error);

    await mongoose.connection.close();
    process.exit(1);
  }
};

resetAdmin();