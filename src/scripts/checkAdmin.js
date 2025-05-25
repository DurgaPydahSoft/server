import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

const checkAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    
    const admin = await User.findOne({ role: 'admin' });
    if (admin) {
      console.log('Admin user found:');
      console.log('Username:', admin.rollNumber);
      console.log('Name:', admin.name);
      console.log('Role:', admin.role);
      console.log('\nNote: Password is hashed in the database for security.');
      console.log('If you haven\'t set ADMIN_PASSWORD in .env, the default password is: admin123');
    } else {
      console.log('No admin user found. Run createAdmin.js to create one.');
    }
    process.exit(0);
  } catch (error) {
    console.error('Error checking admin:', error);
    process.exit(1);
  }
};

checkAdmin(); 