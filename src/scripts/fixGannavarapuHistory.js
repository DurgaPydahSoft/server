import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';

/**
 * Script to fix GANNAVARAPU GEETHA LAKSHMI PRIYA's history record
 * Updates her 2025-2026 history from Active to Expired
 * 
 * Usage: node server/src/scripts/fixGannavarapuHistory.js
 */

async function fixGannavarapuHistory() {
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

    console.log('📊 Found Student:');
    console.log(`   Name: ${student.name}`);
    console.log(`   Roll Number: ${student.rollNumber}`);
    console.log(`   Hostel ID: ${student.hostelId}`);
    console.log(`   Current Academic Year: ${student.academicYear}\n`);

    // Find her 2025-2026 history record with Active status
    const activeHistory = await RoomOccupancyHistory.findOne({
      student: student._id,
      academicYear: '2025-2026',
      status: 'Active'
    });

    if (!activeHistory) {
      console.log('✅ No Active history found for 2025-2026. Already fixed or doesn\'t exist.');
      
      // Show all her history records
      const allHistories = await RoomOccupancyHistory.find({
        student: student._id
      }).sort({ academicYear: 1 }).lean();
      
      console.log(`\n📚 All history records (${allHistories.length}):`);
      for (const h of allHistories) {
        console.log(`   ${h.academicYear}: ${h.status}`);
      }
      return;
    }

    console.log('🔄 Found Active history for 2025-2026:');
    console.log(`   Status: ${activeHistory.status}`);
    console.log(`   Room: ${activeHistory.roomNumber}`);
    console.log(`   Allocated From: ${activeHistory.allocatedFrom}`);
    console.log(`   Allocated To: ${activeHistory.allocatedTo || 'Still active'}`);
    console.log(`   History ID: ${activeHistory._id}\n`);

    console.log('⚠️  Updating status to Expired...');

    const result = await RoomOccupancyHistory.updateOne(
      { _id: activeHistory._id },
      { 
        $set: { 
          status: 'Expired',
          expiryReason: 'academic_year_end',
          allocatedTo: new Date('2026-07-31T23:59:59.999Z')
        } 
      }
    );

    if (result.modifiedCount > 0) {
      console.log('✅ Successfully updated history record to Expired!\n');
      
      // Verify the update
      const updated = await RoomOccupancyHistory.findById(activeHistory._id).lean();
      console.log('✅ Verified update:');
      console.log(`   Status: ${updated.status}`);
      console.log(`   Expiry Reason: ${updated.expiryReason}`);
      console.log(`   Allocated To: ${updated.allocatedTo}\n`);
      
      console.log('🎯 Next steps:');
      console.log('   1. Restart the server: npm start');
      console.log('   2. Clear browser cache: Ctrl+Shift+R');
      console.log('   3. Go to Warden Take Attendance');
      console.log('   4. Select Academic Year: 2025-2026');
      console.log('   5. GANNAVARAPU should NOT appear anymore ✅\n');
    } else {
      console.log('❌ No records were updated. Something went wrong.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

fixGannavarapuHistory();

// Made with Bob