import mongoose from 'mongoose';
import dotenv from 'dotenv';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import User from '../models/User.js';

// Load environment variables
dotenv.config();

const run = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to MongoDB:', uri);
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    // 1. Fetch all active/extended history records
    console.log('🔍 Fetching active and extended RoomOccupancyHistory records...');
    const histories = await RoomOccupancyHistory.find({
      status: { $in: ['Active', 'Extended'] }
    });

    console.log(`Found ${histories.length} active/extended occupancy records in history.`);

    let repairedCount = 0;

    for (const history of histories) {
      if (!history.student) continue;

      // Fetch the corresponding student document
      const student = await User.findOne({
        _id: history.student,
        role: 'student'
      });

      if (!student) {
        console.log(`⚠️ Student not found in User collection for history ID: ${history._id}`);
        continue;
      }

      // Check if there is a mismatch
      const mismatch =
        history.hostel?.toString() !== student.hostel?.toString() ||
        history.hostelCategory?.toString() !== student.hostelCategory?.toString() ||
        history.room?.toString() !== student.room?.toString() ||
        history.roomNumber !== student.roomNumber ||
        history.bedNumber !== student.bedNumber ||
        history.lockerNumber !== student.lockerNumber;

      if (mismatch) {
        console.log(`\n⚙️ Mismatch found for student: ${student.name} (Roll: ${student.rollNumber || 'N/A'})`);
        console.log(`   History values: room=${history.roomNumber}, bed=${history.bedNumber || 'N/A'}, locker=${history.lockerNumber || 'N/A'}, hostel=${history.hostel || 'N/A'}`);
        console.log(`   Student values: room=${student.roomNumber}, bed=${student.bedNumber || 'N/A'}, locker=${student.lockerNumber || 'N/A'}, hostel=${student.hostel || 'N/A'}`);

        // Sync history details to match student values
        history.hostel = student.hostel;
        history.hostelCategory = student.hostelCategory;
        history.room = student.room;
        history.roomNumber = student.roomNumber;
        history.bedNumber = student.bedNumber;
        history.lockerNumber = student.lockerNumber;

        await history.save();
        console.log(`   ✅ Synced history record successfully.`);
        repairedCount++;
      }
    }

    console.log(`\n🎉 Backfill complete. Synced/repaired ${repairedCount} records.`);

  } catch (err) {
    console.error('Error during backfill:', err);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed.');
  }
};

run();
