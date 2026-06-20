import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import { syncStudentHostelFeeSafely } from '../services/feesSyncService.js';

dotenv.config();

const run = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to MongoDB:', uri);
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    // Fetch all active students
    console.log('🔍 Fetching all active students...');
    const students = await User.find({
      role: 'student',
      hostelStatus: 'Active'
    });

    console.log(`Found ${students.length} active students.`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      console.log(`[${i + 1}/${students.length}] Syncing student: ${student.name} (${student.rollNumber})`);
      
      try {
        const result = await syncStudentHostelFeeSafely(student);
        if (result.ok) {
          successCount++;
        } else {
          console.warn(`⚠️ Sync skipped/failed for ${student.rollNumber}:`, result.reason || result.error);
          failCount++;
        }
      } catch (err) {
        console.error(`❌ Unexpected error syncing student ${student.rollNumber}:`, err.message);
        failCount++;
      }
    }

    console.log(`\n🎉 Fee sync complete!`);
    console.log(`   Successfully synced: ${successCount} records`);
    console.log(`   Skipped/Failed: ${failCount} records`);

  } catch (err) {
    console.error('Fatal error during sync process:', err);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed.');
  }
};

run();
