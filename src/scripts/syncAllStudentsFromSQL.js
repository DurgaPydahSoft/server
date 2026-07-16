import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { enrichStudentsAcademics } from '../utils/studentAcademicEnricher.js';

dotenv.config();

async function run() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB.');

    // Fetch all registered students
    console.log('🔍 Fetching all students from MongoDB...');
    const students = await User.find({ role: 'student' });
    console.log(`📋 Found ${students.length} student documents in MongoDB.`);

    if (students.length === 0) {
      console.log('No students to sync.');
      return;
    }

    const CHUNK_SIZE = 50;
    let processedCount = 0;

    console.log(`🔄 Starting batch synchronization in chunks of ${CHUNK_SIZE}...`);
    for (let i = 0; i < students.length; i += CHUNK_SIZE) {
      const chunk = students.slice(i, i + CHUNK_SIZE);
      console.log(`📦 Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(students.length / CHUNK_SIZE)} (students ${i + 1} to ${Math.min(i + CHUNK_SIZE, students.length)})...`);
      
      // enrichStudentsAcademics queries SQL in batch and auto-updates MongoDB for any differences
      await enrichStudentsAcademics(chunk);
      
      processedCount += chunk.length;
      console.log(`✅ Chunk complete. Processed ${processedCount}/${students.length} students.`);
    }

    console.log('🎉 Bulk reconciliation complete! All discrepancies between SQL and MongoDB have been synced.');
  } catch (error) {
    console.error('❌ Error during synchronization:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
    process.exit(0);
  }
}

run();
