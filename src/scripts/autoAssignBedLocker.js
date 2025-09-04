import mongoose from 'mongoose';
import User from '../models/User.js';
import Room from '../models/Room.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Re-assign bed and locker numbers for all students
const autoAssignBedLocker = async () => {
  try {
    console.log('🔄 Starting re-assignment of bed and locker numbers for all students...');
    
    // Get all students (with or without bed/locker assignments)
    const allStudents = await User.find({
      role: 'student'
    }).select('_id name rollNumber roomNumber bedNumber lockerNumber');

    console.log(`📊 Found ${allStudents.length} students to process`);

    if (allStudents.length === 0) {
      console.log('✅ No students found');
      return;
    }

    let assignedCount = 0;
    let skippedCount = 0;

    // First, clear all existing bed and locker assignments
    console.log('🧹 Clearing all existing bed and locker assignments...');
    await User.updateMany(
      { role: 'student' },
      { 
        $unset: { 
          bedNumber: 1, 
          lockerNumber: 1 
        } 
      }
    );
    console.log('✅ Cleared all existing assignments');

    for (const student of allStudents) {
      try {
        // Skip if student doesn't have a room assigned
        if (!student.roomNumber) {
          console.log(`⚠️  Skipping ${student.name} (${student.rollNumber}) - No room assigned`);
          skippedCount++;
          continue;
        }

        // Get room details
        const room = await Room.findOne({ roomNumber: student.roomNumber });
        if (!room) {
          console.log(`⚠️  Skipping ${student.name} (${student.rollNumber}) - Room ${student.roomNumber} not found`);
          skippedCount++;
          continue;
        }

        // Get all students in this room to find occupied beds/lockers
        const roomStudents = await User.find({
          role: 'student',
          roomNumber: student.roomNumber,
          bedNumber: { $exists: true, $ne: '' },
          lockerNumber: { $exists: true, $ne: '' }
        }).select('bedNumber lockerNumber');

        // Extract occupied bed and locker numbers
        const occupiedBeds = roomStudents.map(s => s.bedNumber).filter(Boolean);
        const occupiedLockers = roomStudents.map(s => s.lockerNumber).filter(Boolean);

        // Find first available bed and corresponding locker
        let assignedBed = null;
        let assignedLocker = null;

        for (let i = 1; i <= room.bedCount; i++) {
          const bedNumber = `${student.roomNumber} Bed ${i}`;
          const lockerNumber = `${student.roomNumber} Locker ${i}`;

          if (!occupiedBeds.includes(bedNumber) && !occupiedLockers.includes(lockerNumber)) {
            assignedBed = bedNumber;
            assignedLocker = lockerNumber;
            break;
          }
        }

        if (assignedBed && assignedLocker) {
          // Update student with assigned bed and locker
          await User.findByIdAndUpdate(student._id, {
            bedNumber: assignedBed,
            lockerNumber: assignedLocker
          });

          console.log(`✅ Assigned ${student.name} (${student.rollNumber}) to ${assignedBed} and ${assignedLocker}`);
          assignedCount++;
        } else {
          console.log(`⚠️  No available bed/locker pair found for ${student.name} (${student.rollNumber}) in room ${student.roomNumber}`);
          skippedCount++;
        }

      } catch (error) {
        console.error(`❌ Error processing ${student.name} (${student.rollNumber}):`, error.message);
        skippedCount++;
      }
    }

    console.log('\n📈 Re-assignment Summary:');
    console.log(`✅ Successfully assigned: ${assignedCount} students`);
    console.log(`⚠️  Skipped: ${skippedCount} students`);
    console.log(`📊 Total processed: ${allStudents.length} students`);

  } catch (error) {
    console.error('❌ Error in auto-assignment process:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await autoAssignBedLocker();
    console.log('\n🎉 Re-assignment process completed!');
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

// Run the script
main();
