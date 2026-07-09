import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';

async function checkStudentHistory() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find GANNAVARAPU GEETHA LAKSHMI PRIYA
    const student = await User.findOne({ 
      name: /GANNAVARAPU.*GEETHA/i 
    }).lean();

    if (!student) {
      console.log('❌ Student not found');
      return;
    }

    console.log('📊 Student Info:');
    console.log(`   Name: ${student.name}`);
    console.log(`   Roll Number: ${student.rollNumber}`);
    console.log(`   Hostel ID: ${student.hostelId}`);
    console.log(`   Current Academic Year: ${student.academicYear}`);
    console.log(`   Hostel Status: ${student.hostelStatus}`);
    console.log(`   Application Status: ${student.applicationStatus}\n`);

    // Find all history records
    const histories = await RoomOccupancyHistory.find({
      student: student._id
    }).sort({ academicYear: 1 }).lean();

    console.log(`📚 Found ${histories.length} history records:\n`);

    for (const history of histories) {
      console.log(`   Academic Year: ${history.academicYear}`);
      console.log(`   Status: ${history.status}`);
      console.log(`   Expiry Reason: ${history.expiryReason || 'N/A'}`);
      console.log(`   Allocated From: ${history.allocatedFrom}`);
      console.log(`   Allocated To: ${history.allocatedTo || 'Still active'}`);
      console.log(`   Room: ${history.roomNumber}`);
      console.log(`   ID: ${history._id}\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

checkStudentHistory();

// Made with Bob
