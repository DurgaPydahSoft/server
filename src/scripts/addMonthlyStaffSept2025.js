import mongoose from 'mongoose';
import dotenv from 'dotenv';
import StaffGuest from '../models/StaffGuest.js';
import Admin from '../models/Admin.js';

// Load environment variables
dotenv.config();

// Default daily rate (should match your settings)
const DEFAULT_DAILY_RATE = 100;

// Calculate charges for monthly staff
const calculateMonthlyCharges = (selectedMonth, dailyRate = DEFAULT_DAILY_RATE) => {
  const [year, month] = selectedMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return daysInMonth * dailyRate;
};

// IMPORTANT: Set the month you want to add staff for
// Format: YYYY-MM (e.g., '2025-12' for December 2025)
// NOTE: If the month is in the past, staff will be automatically marked as expired
// For current/future months, staff will remain active
const SELECTED_MONTH = '2025-12'; // Change this to the desired month

// Sample staff data - Modify this array with your staff members
const staffMembers = [
  {
    name: 'John Doe',
    gender: 'Male',
    profession: 'Security Guard',
    phoneNumber: '9876543210',
    email: 'john.doe@example.com',
    department: 'Security',
    purpose: 'Monthly stay',
    roomNumber: '303', // Set room number as string (e.g., '303') or null
    bedNumber: null,    // Set bed number as string (e.g., '1') or null
    dailyRate: null     // null will use default rate
  },
  // Add more staff members here
  // {
  //   name: 'Jane Smith',
  //   gender: 'Female',
  //   profession: 'Housekeeping',
  //   phoneNumber: '9876543211',
  //   email: 'jane.smith@example.com',
  //   department: 'Housekeeping',
  //   purpose: 'Monthly stay',
  //   roomNumber: null,
  //   bedNumber: null,
  //   dailyRate: null
  // },
];

const addMonthlyStaff = async () => {
  try {
    // Connect to MongoDB
    const connectWithRetry = async () => {
      try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel_complaint_db');
        console.log('✅ Connected to MongoDB');
      } catch (err) {
        console.error('❌ MongoDB connection error. Retrying in 5 seconds...', err.message);
        setTimeout(connectWithRetry, 5000);
      }
    };

    await connectWithRetry();

    // Get a super admin or first admin for createdBy field
    let admin = await Admin.findOne({ role: 'super_admin' });
    if (!admin) {
      admin = await Admin.findOne();
    }
    
    if (!admin) {
      console.error('❌ No admin found. Please create an admin first.');
      process.exit(1);
    }

    console.log(`📋 Using admin: ${admin.username} (${admin._id})`);
    console.log(`📅 Adding staff members for ${SELECTED_MONTH}`);
    console.log(`📊 Total staff members to add: ${staffMembers.length}\n`);

    // Check if the selected month is in the past
    const [year, month] = SELECTED_MONTH.split('-').map(Number);
    const lastDayOfMonth = new Date(year, month, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (today > lastDayOfMonth) {
      console.log('⚠️  WARNING: The selected month is in the past!');
      console.log(`   Selected month: ${SELECTED_MONTH}`);
      console.log(`   Last day of month: ${lastDayOfMonth.toLocaleDateString()}`);
      console.log(`   Today: ${today.toLocaleDateString()}`);
      console.log('   Staff will be automatically marked as expired when fetched.');
      console.log('   Consider using the current or a future month.\n');
    }

    const selectedMonth = SELECTED_MONTH;
    const results = {
      success: [],
      errors: []
    };

    for (let i = 0; i < staffMembers.length; i++) {
      const staffData = staffMembers[i];
      
      try {
        // Validate phone number
        if (!/^[0-9]{10}$/.test(staffData.phoneNumber)) {
          throw new Error(`Invalid phone number: ${staffData.phoneNumber}. Must be 10 digits.`);
        }

        // Check if staff member already exists
        const existingStaff = await StaffGuest.findOne({
          phoneNumber: staffData.phoneNumber,
          isActive: true
        });

        if (existingStaff) {
          console.log(`⚠️  Staff with phone ${staffData.phoneNumber} already exists. Skipping...`);
          results.errors.push({
            staff: staffData.name,
            reason: 'Phone number already exists'
          });
          continue;
        }

        // Calculate charges for the month
        const dailyRate = staffData.dailyRate || DEFAULT_DAILY_RATE;
        const calculatedCharges = calculateMonthlyCharges(selectedMonth, dailyRate);

        // Convert roomNumber and bedNumber to strings if they exist
        const roomNumberStr = staffData.roomNumber 
          ? String(staffData.roomNumber).trim() 
          : null;
        const bedNumberStr = staffData.bedNumber 
          ? String(staffData.bedNumber).trim() 
          : null;

        // Create staff member
        const staffGuest = new StaffGuest({
          name: staffData.name.trim(),
          type: 'staff',
          gender: staffData.gender,
          profession: staffData.profession.trim(),
          phoneNumber: staffData.phoneNumber.trim(),
          email: staffData.email ? staffData.email.trim().toLowerCase() : undefined,
          department: staffData.department ? staffData.department.trim() : undefined,
          purpose: staffData.purpose || 'Monthly stay',
          stayType: 'monthly',
          selectedMonth: selectedMonth,
          roomNumber: roomNumberStr,
          bedNumber: bedNumberStr,
          dailyRate: staffData.dailyRate || null,
          calculatedCharges: calculatedCharges,
          isActive: true,
          checkInTime: new Date(),
          checkOutTime: null,
          createdBy: admin._id
        });

        await staffGuest.save();
        
        // Verify the staff was actually saved
        const savedStaff = await StaffGuest.findById(staffGuest._id);
        if (!savedStaff) {
          throw new Error('Staff was not saved to database');
        }
        
        console.log(`✅ Added: ${staffData.name} (${staffData.phoneNumber}) - Charges: ₹${calculatedCharges}`);
        console.log(`   ID: ${savedStaff._id}, Active: ${savedStaff.isActive}, Month: ${savedStaff.selectedMonth}`);
        results.success.push({
          name: staffData.name,
          phone: staffData.phoneNumber,
          charges: calculatedCharges,
          id: savedStaff._id.toString()
        });

      } catch (error) {
        console.error(`❌ Error adding ${staffData.name}:`, error.message);
        results.errors.push({
          staff: staffData.name,
          reason: error.message
        });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully added: ${results.success.length}`);
    console.log(`❌ Failed: ${results.errors.length}`);
    
    if (results.success.length > 0) {
      console.log('\n✅ Successfully Added:');
      results.success.forEach((staff, index) => {
        console.log(`   ${index + 1}. ${staff.name} - ₹${staff.charges}`);
      });
    }

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.staff}: ${error.reason}`);
      });
    }

    // Verification: Query the database to confirm records were saved
    console.log('\n' + '='.repeat(60));
    console.log('🔍 VERIFICATION');
    console.log('='.repeat(60));
    
    // Check all records (both active and inactive)
    const allRecords = await StaffGuest.find({
      type: 'staff',
      stayType: 'monthly',
      selectedMonth: selectedMonth
    }).select('name phoneNumber isActive selectedMonth roomNumber bedNumber calculatedCharges createdAt').sort({ createdAt: -1 });
    
    const activeRecords = allRecords.filter(r => r.isActive === true);
    const inactiveRecords = allRecords.filter(r => r.isActive === false);
    
    console.log(`\n📋 Total records for ${selectedMonth}: ${allRecords.length}`);
    console.log(`   ✅ Active: ${activeRecords.length}`);
    console.log(`   ❌ Inactive (expired): ${inactiveRecords.length}`);
    
    if (activeRecords.length > 0) {
      console.log(`\n✅ Active staff for ${selectedMonth}:`);
      activeRecords.forEach((staff, index) => {
        console.log(`   ${index + 1}. ${staff.name} (${staff.phoneNumber})`);
        console.log(`      Room: ${staff.roomNumber || 'N/A'}, Charges: ₹${staff.calculatedCharges}`);
      });
    }
    
    if (inactiveRecords.length > 0) {
      console.log(`\n❌ Inactive staff for ${selectedMonth} (expired):`);
      inactiveRecords.forEach((staff, index) => {
        console.log(`   ${index + 1}. ${staff.name} (${staff.phoneNumber})`);
        console.log(`      Created: ${new Date(staff.createdAt).toLocaleString()}`);
      });
      console.log('\n💡 Note: Inactive staff can be renewed using the Renew button in the staff/guest page.');
    }

    console.log('\n✨ Script completed!');
    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
};

// Run the script
addMonthlyStaff();

