import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

// Load environment variables
dotenv.config();

const removeOldAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel_complaint_db');
    console.log('Connected to MongoDB');

    // Find old admin user
    const oldAdmin = await User.findOne({ role: 'admin' });
    if (oldAdmin) {
      console.log('Found old admin user:', {
        id: oldAdmin._id,
        name: oldAdmin.name,
        rollNumber: oldAdmin.rollNumber,
        role: oldAdmin.role
      });
      
      // Remove old admin user
      await User.findByIdAndDelete(oldAdmin._id);
      console.log('✅ Old admin user removed from User schema');
    } else {
      console.log('ℹ️  No old admin user found in User schema');
    }

    console.log('🎉 Old admin cleanup completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error removing old admin:', error);
    process.exit(1);
  }
};

removeOldAdmin(); 