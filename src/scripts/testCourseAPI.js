import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import dotenv from 'dotenv';

dotenv.config();

const testCourseAPI = async () => {
  try {
    console.log('🧪 Testing Course Management API...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Test 1: Get all courses
    console.log('\n📚 Test 1: Getting all courses...');
    const courses = await Course.find({ isActive: true })
      .select('name code description duration durationUnit')
      .sort({ name: 1 });
    
    console.log(`Found ${courses.length} active courses:`);
    courses.forEach(course => {
      console.log(`  - ${course.name} (${course.code}): ${course.duration} ${course.durationUnit}`);
    });
    
    // Test 2: Get all branches
    console.log('\n🌿 Test 2: Getting all branches...');
    const branches = await Branch.find()
      .populate('course', 'name code')
      .sort({ createdAt: -1 });
    
    console.log(`Found ${branches.length} branches:`);
    branches.forEach(branch => {
      console.log(`  - ${branch.name} (${branch.code}) - Course: ${branch.course.name}`);
    });
    
    // Test 3: Get branches by course
    console.log('\n🔗 Test 3: Getting branches by course...');
    const btechCourse = await Course.findOne({ code: 'BTECH' });
    if (btechCourse) {
      const btechBranches = await Branch.find({ 
        course: btechCourse._id, 
        isActive: true 
      })
      .select('name code description')
      .sort({ name: 1 });
      
      console.log(`B.Tech branches (${btechBranches.length}):`);
      btechBranches.forEach(branch => {
        console.log(`  - ${branch.name} (${branch.code})`);
      });
    }
    
    // Test 4: Get courses with branches
    console.log('\n📊 Test 4: Getting courses with branches...');
    const coursesWithBranches = await Course.find({ isActive: true })
      .populate({
        path: 'branches',
        match: { isActive: true },
        select: 'name code'
      })
      .select('name code description duration durationUnit')
      .sort({ name: 1 });
    
    console.log('Courses with their branches:');
    coursesWithBranches.forEach(course => {
      console.log(`  ${course.name} (${course.code}):`);
      if (course.branches && course.branches.length > 0) {
        course.branches.forEach(branch => {
          console.log(`    - ${branch.name} (${branch.code})`);
        });
      } else {
        console.log(`    No branches found`);
      }
    });
    
    console.log('\n🎉 All tests passed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Run the test
testCourseAPI(); 