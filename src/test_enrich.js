import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import User from './models/User.js';

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');
    const student = await User.findOne({ name: /harsha hostel testing/i });
    if (!student) {
      console.log('Student not found by name!');
      return;
    }
    console.log('RAW STUDENT DOCUMENT:');
    console.log(JSON.stringify(student.toObject(), null, 2));
  } catch (error) {
    console.error('Error running script:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
