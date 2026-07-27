import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env files robustly
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in env variables.');
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB successfully!');
};

const run = async () => {
  try {
    await connectDB();

    const isExecute = process.argv.includes('--execute');
    console.log(isExecute ? '🚀 RUNNING IN EXECUTE MODE' : '🔍 RUNNING IN DRY-RUN MODE (No database modifications will be made)');

    console.log('Searching for students in Academic Year 2025-2026 with undefined or missing applicationStatus...');
    
    const query = {
      role: 'student',
      academicYear: '2025-2026',
      $or: [
        { applicationStatus: { $exists: false } },
        { applicationStatus: null }
      ]
    };

    const targetStudents = await User.find(query).select('name rollNumber academicYear applicationStatus').lean();
    
    console.log(`Found ${targetStudents.length} students matching criteria.`);
    
    if (targetStudents.length === 0) {
      console.log('No students found that require update.');
      return;
    }

    console.log('\nPreview of students to be updated:');
    targetStudents.forEach((student, index) => {
      console.log(`${index + 1}. ${student.name} (${student.rollNumber || 'No Roll Number'})`);
    });

    if (!isExecute) {
      console.log('\n[Dry-Run] Stats:');
      console.log(`Total students to update: ${targetStudents.length}`);
      console.log('To apply these changes, run the script with the --execute flag:');
      console.log('node server/src/scripts/backfill_student_status_2025_2026.js --execute');
      return;
    }

    console.log('\nUpdating records...');
    const result = await User.updateMany(query, {
      $set: { applicationStatus: 'Active' }
    });

    console.log(`Successfully updated ${result.modifiedCount} student records to 'Active'!`);

  } catch (error) {
    console.error('Migration failed with error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

run();
