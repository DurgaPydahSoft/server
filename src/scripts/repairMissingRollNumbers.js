import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { repairMissingRollNumber } from '../utils/studentAcademicEnricher.js';

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI);

const students = await User.find({
  role: 'student',
  $or: [
    { rollNumber: { $exists: false } },
    { rollNumber: null },
    { rollNumber: '' }
  ]
});

for (const student of students) {
  const repaired = await repairMissingRollNumber(student);
  if (repaired) {
    await student.save({ validateModifiedOnly: true });
    console.log(`Repaired rollNumber for ${student.name}: ${student.rollNumber}`);
  } else {
    console.warn(`Could not repair rollNumber for ${student.name} (${student._id})`);
  }
}

console.log(`Processed ${students.length} student(s)`);
await mongoose.disconnect();
