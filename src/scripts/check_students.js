import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import { fetchStudentsForAcademicYear } from '../utils/applicationExpiryService.js';

dotenv.config();

const run = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management';
  await mongoose.connect(uri);
  console.log('Connected to DB');

  // Query for 2025-2026
  const result = await fetchStudentsForAcademicYear({
    academicYear: '2025-2026',
    filters: { hostelStatus: 'Active' },
    page: 1,
    limit: 1000
  });

  console.log(`Found ${result.students.length} students in 2025-2026 under Active filter.`);
  
  const target = result.students.find(s => s.rollNumber === '25320-CM-080');
  if (target) {
    console.log(`✅ Found TIRLANGI SIREESHA!`);
    console.log(`   Hostel Status: ${target.hostelStatus}`);
    console.log(`   Application Status: ${target.applicationStatus}`);
    console.log(`   Enrollment History Status: ${target.enrollmentHistoryStatus}`);
    console.log(`   Academic Year: ${target.academicYear}`);
    console.log(`   Room: ${target.roomNumber}`);
  } else {
    console.log(`❌ TIRLANGI SIREESHA NOT found!`);
  }

  await mongoose.disconnect();
};

run().catch(console.error);
