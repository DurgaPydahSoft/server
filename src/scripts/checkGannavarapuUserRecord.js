import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const User = mongoose.model(
  'User',
  new mongoose.Schema({}, { strict: false }),
  'users'
);

async function checkGannavarapuUserRecord() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find GANNAVARAPU
    const student = await User.findOne({
      role: 'student',
      name: /GANNAVARAPU.*GEETHA.*LAKSHMI.*PRIYA/i
    }).lean();

    if (!student) {
      console.log('❌ Student not found');
      return;
    }

    console.log('📊 GANNAVARAPU GEETHA LAKSHMI PRIYA - User Record:');
    console.log('   Name:', student.name);
    console.log('   Roll Number:', student.rollNumber);
    console.log('   Hostel ID:', student.hostelId);
    console.log('   Academic Year:', student.academicYear);
    console.log('   Hostel Status:', student.hostelStatus);
    console.log('   Application Status:', student.applicationStatus);
    console.log('   Created At:', student.createdAt);
    console.log('   Updated At:', student.updatedAt);
    console.log('\n🔍 Key Fields for Filtering:');
    console.log('   - academicYear:', student.academicYear, '(matches 2025-2026? ', student.academicYear === '2025-2026', ')');
    console.log('   - hostelStatus:', student.hostelStatus);
    console.log('   - applicationStatus:', student.applicationStatus);
    
    console.log('\n💡 Analysis:');
    if (student.academicYear === '2025-2026') {
      console.log('   ✅ She WILL be included in liveQuery (line 551)');
      
      if (student.applicationStatus === 'Active' || !student.applicationStatus) {
        console.log('   ⚠️  Her applicationStatus is Active (or undefined, defaults to Active)');
        console.log('   ⚠️  This makes her PASS the Active filter (line 620-628)');
        console.log('\n🎯 SOLUTION:');
        console.log('   Need to update her User record:');
        console.log('   - applicationStatus: "Expired" (or "Withdrawn")');
        console.log('   OR');
        console.log('   - academicYear: "2026-2027" (if she renewed)');
      } else {
        console.log('   ✅ Her applicationStatus is', student.applicationStatus);
        console.log('   ✅ She should NOT pass the Active filter');
      }
    } else {
      console.log('   ✅ She will NOT be included in liveQuery');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

checkGannavarapuUserRecord();

// Made with Bob
