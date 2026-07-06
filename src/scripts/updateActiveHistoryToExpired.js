import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });

import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';

/**
 * Script to update RoomOccupancyHistory records from 'Active' to 'Expired'
 * for students who have been renewed to a newer academic year
 * 
 * Problem: Students who were renewed still have 'Active' status in their old year's history
 * Solution: Update history status to 'Expired' if student's current year > history year
 * 
 * Usage: 
 *   Dry run: node server/src/scripts/updateActiveHistoryToExpired.js --dry-run
 *   Live run: node server/src/scripts/updateActiveHistoryToExpired.js
 */

const isDryRun = process.argv.includes('--dry-run');

async function updateActiveHistoryToExpired() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No data will be updated');
      console.log('═══════════════════════════════════════════════════════\n');
    } else {
      console.log('⚠️  LIVE MODE - Data will be permanently updated');
      console.log('═══════════════════════════════════════════════════════\n');
    }

    // Get all students
    const students = await User.find({ role: 'student' })
      .select('_id name rollNumber academicYear')
      .lean();
    
    console.log(`📊 Found ${students.length} students\n`);

    let updatedCount = 0;
    let checkedCount = 0;

    for (const student of students) {
      if (!student.academicYear) continue;

      const currentYear = parseInt(student.academicYear.split('-')[0], 10);

      // Find Active history records for this student
      const activeHistories = await RoomOccupancyHistory.find({
        student: student._id,
        status: 'Active'
      }).lean();

      for (const history of activeHistories) {
        if (!history.academicYear) continue;

        const historyYear = parseInt(history.academicYear.split('-')[0], 10);

        // If history year is BEFORE current year, it should be Expired
        if (historyYear < currentYear) {
          updatedCount++;

          console.log(`🔄 Found Active history that should be Expired:`);
          console.log(`   Student: ${student.name} (${student.rollNumber})`);
          console.log(`   Current Year: ${student.academicYear}`);
          console.log(`   History Year: ${history.academicYear}`);
          console.log(`   History Status: ${history.status} → Expired`);
          console.log(`   History ID: ${history._id}`);

          if (!isDryRun) {
            await RoomOccupancyHistory.updateOne(
              { _id: history._id },
              { 
                $set: { 
                  status: 'Expired',
                  expiryReason: 'academic_year_end'
                } 
              }
            );
            console.log(`   ✅ Updated to Expired\n`);
          } else {
            console.log(`   ℹ️  Would update to Expired (dry-run mode)\n`);
          }
        }
      }

      checkedCount++;
      if (checkedCount % 50 === 0) {
        console.log(`✓ Checked ${checkedCount}/${students.length} students...`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    if (isDryRun) {
      console.log('✅ DRY RUN COMPLETE!');
      console.log(`   Students checked: ${checkedCount}`);
      console.log(`   Active histories that should be Expired: ${updatedCount}`);
      console.log(`\n💡 To actually update these records, run:`);
      console.log(`   node server/src/scripts/updateActiveHistoryToExpired.js\n`);
    } else {
      console.log('✅ UPDATE COMPLETE!');
      console.log(`   Students checked: ${checkedCount}`);
      console.log(`   Histories updated to Expired: ${updatedCount}\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

updateActiveHistoryToExpired();

// Made with Bob