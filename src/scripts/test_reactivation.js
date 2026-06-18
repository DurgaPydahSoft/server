import mongoose from 'mongoose';
import dotenv from 'dotenv';
// Load schemas
import '../models/Hostel.js';
import '../models/HostelCategory.js';
import '../models/Room.js';
import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import ApplicationExpiryConfig from '../models/ApplicationExpiryConfig.js';
import { processDueApplicationExpiries } from '../utils/applicationExpiryService.js';

// Load .env
dotenv.config();

const run = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to:', uri);
    await mongoose.connect(uri);

    // Find a student who is currently Expired
    const expiredStudent = await User.findOne({
      role: 'student',
      hostelStatus: 'Inactive',
      applicationStatus: 'Expired'
    });

    if (!expiredStudent) {
      console.log('No expired student found in DB to run test.');
      return;
    }

    console.log(`\nFound expired student: ${expiredStudent.name} (Roll: ${expiredStudent.rollNumber})`);
    console.log(`Current status: hostelStatus=${expiredStudent.hostelStatus}, applicationStatus=${expiredStudent.applicationStatus}, bed=${expiredStudent.bedNumber}`);

    // Find their last Expired history record
    const lastHistory = await RoomOccupancyHistory.findOne({
      student: expiredStudent._id,
      academicYear: expiredStudent.academicYear,
      status: 'Expired'
    }).sort({ allocatedTo: -1 });

    if (!lastHistory) {
      console.log('No closed history record found for this student.');
      return;
    }
    console.log(`Last closed occupancy: room=${lastHistory.roomNumber}, bed=${lastHistory.bedNumber}, status=${lastHistory.status}, allocatedTo=${lastHistory.allocatedTo}`);

    // Now, create an ApplicationExpiryConfig that extends their semester end date into the future
    // e.g. next month
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);
    const month = futureDate.getMonth() + 1;
    const day = futureDate.getDate();

    // Use the student's actual course and year of study
    // Let's get them from history or profile
    const course = lastHistory.course || expiredStudent.course;
    const year = lastHistory.yearOfStudy || expiredStudent.year;

    console.log(`\nCreating ApplicationExpiryConfig for Academic Year ${expiredStudent.academicYear}, Course ${course}, Year ${year} pointing to future date (Month: ${month}, Day: ${day})...`);
    
    // Store original config if any to restore later
    const originalConfig = await ApplicationExpiryConfig.findOne({
      academicYear: expiredStudent.academicYear,
      courseName: course.trim(),
      yearOfStudy: Number(year)
    }).lean();

    await ApplicationExpiryConfig.findOneAndUpdate(
      {
        academicYear: expiredStudent.academicYear,
        courseName: course.trim(),
        yearOfStudy: Number(year)
      },
      {
        academicYear: expiredStudent.academicYear,
        courseName: course.trim(),
        yearOfStudy: Number(year),
        expiryMonth: month,
        expiryDay: day,
        isActive: true,
        notes: 'TEST REACTIVATION CONFIG'
      },
      { upsert: true, new: true }
    );

    console.log('\nRunning processDueApplicationExpiries() to process reactivations...');
    const result = await processDueApplicationExpiries();
    console.log('Result of processing:', result);

    // Fetch student profile again to verify reactivation
    const updatedStudent = await User.findById(expiredStudent._id);
    console.log(`\nUpdated student status: hostelStatus=${updatedStudent.hostelStatus}, applicationStatus=${updatedStudent.applicationStatus}, bed=${updatedStudent.bedNumber}`);

    // Fetch history record again
    const updatedHistory = await RoomOccupancyHistory.findById(lastHistory._id);
    console.log(`Updated occupancy status: status=${updatedHistory.status}, allocatedTo=${updatedHistory.allocatedTo}`);

    // Assertions
    if (updatedStudent.hostelStatus === 'Active' && updatedStudent.applicationStatus === 'Active' && updatedStudent.bedNumber === lastHistory.bedNumber && updatedHistory.status === 'Active' && updatedHistory.allocatedTo === null) {
      console.log('\n✅ SUCCESS: Student was successfully reactivated and their room/bed assignments were restored!');
    } else {
      console.log('\n❌ FAILURE: Reactivation assertion checks failed.');
    }

    // Clean up: Restore student to expired and clean up config
    console.log('\nCleaning up database modifications...');
    
    // Re-expire student
    updatedStudent.hostelStatus = 'Inactive';
    updatedStudent.applicationStatus = 'Expired';
    updatedStudent.bedNumber = undefined;
    updatedStudent.lockerNumber = undefined;
    await updatedStudent.save();

    updatedHistory.status = 'Expired';
    updatedHistory.allocatedTo = lastHistory.allocatedTo;
    await updatedHistory.save();

    if (originalConfig) {
      await ApplicationExpiryConfig.findOneAndReplace({ _id: originalConfig._id }, originalConfig);
    } else {
      await ApplicationExpiryConfig.deleteOne({
        academicYear: expiredStudent.academicYear,
        courseName: course.trim(),
        yearOfStudy: Number(year)
      });
    }
    console.log('Cleanup completed.');

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await mongoose.connection.close();
  }
};

run();
