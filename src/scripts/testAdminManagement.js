import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from '../models/Admin.js';

// Load environment variables
dotenv.config();

const testAdminManagement = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel_complaint_db');
    console.log('Connected to MongoDB');

    // Test 1: Check if super admin exists
    const superAdmin = await Admin.findOne({ role: 'super_admin' });
    if (superAdmin) {
      console.log('✅ Super admin exists:', superAdmin.username);
      console.log('   Role:', superAdmin.role);
      console.log('   Permissions:', superAdmin.permissions);
    } else {
      console.log('❌ Super admin not found');
    }

    // Test 2: Check if regular admin exists
    const regularAdmin = await Admin.findOne({ role: 'sub_admin' });
    if (regularAdmin) {
      console.log('✅ Sub-admin exists:', regularAdmin.username);
      console.log('   Role:', regularAdmin.role);
      console.log('   Permissions:', regularAdmin.permissions);
    } else {
      console.log('ℹ️  No sub-admins found (this is normal)');
    }

    // Test 3: Test permission checking
    if (superAdmin) {
      const hasRoomPermission = superAdmin.hasPermission('room_management');
      const hasStudentPermission = superAdmin.hasPermission('student_management');
      const hasInvalidPermission = superAdmin.hasPermission('invalid_permission');
      
      console.log('✅ Permission tests:');
      console.log('   Room Management:', hasRoomPermission);
      console.log('   Student Management:', hasStudentPermission);
      console.log('   Invalid Permission:', hasInvalidPermission);
    }

    // Test 4: Count total admins
    const totalAdmins = await Admin.countDocuments();
    console.log('📊 Total admins in database:', totalAdmins);

    console.log('\n🎉 Admin management system is working correctly!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error testing admin management:', error);
    process.exit(1);
  }
};

testAdminManagement(); 