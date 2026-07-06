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
 * Script to clean up incorrect RoomOccupancyHistory records
 *
 * Problem: Students who joined in 2026-2027 have history records for 2025-2026
 * Solution: Delete history records ONLY for students whose roll number indicates they joined AFTER the history year
 *
 * Logic:
 * - Roll number starting with "26" = joined in 2026-2027 (should NOT have 2025-2026 history)
 * - Roll number starting with "25" = joined in 2025-2026 (CAN have 2025-2026 history - renewed student)
 * - Roll number starting with "24" = joined in 2024-2025 (CAN have 2024-2025, 2025-2026 history - renewed student)
 *
 * Usage:
 *   Dry run (preview only): node server/src/scripts/cleanupIncorrectHistory.js --dry-run
 *   Live run (delete data): node server/src/scripts/cleanupIncorrectHistory.js
 */

// Check if dry-run mode is enabled
const isDryRun = process.argv.includes('--dry-run');

/**
 * Extract the year a student joined based on their hostel ID or roll number
 * Priority: Hostel ID > Roll Number
 * @param {string} hostelId - Student's hostel ID (e.g., GH26006, GH25004)
 * @param {string} rollNumber - Student's roll number
 * @returns {number|null} - Year student joined (e.g., 2026) or null if can't determine
 */
function extractJoinYear(hostelId, rollNumber) {
  // Priority 1: Check Hostel ID (most reliable)
  if (hostelId) {
    // Match patterns like: GH26006, GH25004, etc.
    const hostelMatch = hostelId.match(/(\d{2})\d+$/);
    if (hostelMatch) {
      const yearPrefix = parseInt(hostelMatch[1], 10);
      // Only accept reasonable years (20-30 for 2020-2030)
      if (yearPrefix >= 20 && yearPrefix <= 30) {
        return 2000 + yearPrefix;
      }
    }
  }
  
  // Priority 2: Check Roll Number
  if (rollNumber) {
    // Pattern 1: Starts with 2 digits (26ECE049, 25320-CM-080, 24320-CM-044, 23AG38)
    const startMatch = rollNumber.match(/^(\d{2})/);
    if (startMatch) {
      const yearPrefix = parseInt(startMatch[1], 10);
      // Only accept reasonable years (20-30 for 2020-2030)
      if (yearPrefix >= 20 && yearPrefix <= 30) {
        return 2000 + yearPrefix;
      }
    }
    
    // Pattern 2: Year after slash (PTV-DA/25-07, ABC/26-123)
    const slashMatch = rollNumber.match(/\/(\d{2})-/);
    if (slashMatch) {
      const yearPrefix = parseInt(slashMatch[1], 10);
      if (yearPrefix >= 20 && yearPrefix <= 30) {
        return 2000 + yearPrefix;
      }
    }
  }
  
  return null;
}

async function cleanupIncorrectHistory() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No data will be deleted');
      console.log('═══════════════════════════════════════════════════════\n');
    } else {
      console.log('⚠️  LIVE MODE - Data will be permanently deleted');
      console.log('═══════════════════════════════════════════════════════\n');
    }

    // Find all students with hostelId and rollNumber
    const students = await User.find({ role: 'student' })
      .select('_id name rollNumber hostelId academicYear')
      .lean();
    console.log(`📊 Found ${students.length} students\n`);

    let foundCount = 0;
    let checkedCount = 0;
    let skippedRenewedCount = 0;

    for (const student of students) {
      if (!student.academicYear) continue;

      const joinYear = extractJoinYear(student.hostelId, student.rollNumber);
      
      // Find history records for this student
      const historyRecords = await RoomOccupancyHistory.find({
        student: student._id
      }).lean();

      for (const history of historyRecords) {
        if (!history.academicYear) continue;
        
        const historyYear = parseInt(history.academicYear.split('-')[0], 10);
        
        // Only delete if we can determine join year AND history year is BEFORE join year
        if (joinYear && historyYear < joinYear) {
          foundCount++;
          
          // Determine source of join year for logging
          const joinYearSource = student.hostelId && student.hostelId.match(/(\d{2})\d+$/)
            ? `hostel ID: ${student.hostelId}`
            : `roll number: ${student.rollNumber}`;
          
          console.log(`❌ Found incorrect history:`);
          console.log(`   Student: ${student.name} (${student.rollNumber})`);
          console.log(`   Hostel ID: ${student.hostelId || 'N/A'}`);
          console.log(`   Join Year: ${joinYear} (from ${joinYearSource})`);
          console.log(`   Current Year: ${student.academicYear}`);
          console.log(`   History Year: ${history.academicYear}`);
          console.log(`   History ID: ${history._id}`);
          console.log(`   Reason: History year ${historyYear} is before join year ${joinYear}`);
          
          if (!isDryRun) {
            console.log(`   🗑️  Deleting history record...\n`);
            await RoomOccupancyHistory.deleteOne({ _id: history._id });
          } else {
            console.log(`   ℹ️  Would delete this record (dry-run mode)\n`);
          }
        } else if (joinYear && historyYear >= joinYear) {
          // This is a valid history record for a renewed student
          skippedRenewedCount++;
          if (isDryRun && skippedRenewedCount <= 5) {
            console.log(`✅ Valid history (renewed student):`);
            console.log(`   Student: ${student.name} (${student.rollNumber})`);
            console.log(`   Join Year: ${joinYear}`);
            console.log(`   History Year: ${history.academicYear}`);
            console.log(`   Reason: Student was enrolled in this year\n`);
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
      console.log(`   Incorrect histories found: ${foundCount}`);
      console.log(`   Valid histories (renewed students): ${skippedRenewedCount}`);
      console.log(`\n💡 To actually delete these records, run:`);
      console.log(`   node server/src/scripts/cleanupIncorrectHistory.js\n`);
    } else {
      console.log('✅ CLEANUP COMPLETE!');
      console.log(`   Students checked: ${checkedCount}`);
      console.log(`   Incorrect histories deleted: ${foundCount}`);
      console.log(`   Valid histories preserved: ${skippedRenewedCount}\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

cleanupIncorrectHistory();

// Made with Bob
