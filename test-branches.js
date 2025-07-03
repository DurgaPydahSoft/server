const mongoose = require('mongoose');
const Course = require('./src/models/Course.js');
const Branch = require('./src/models/Branch.js');

async function testEndpoints() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/hostel_complaint_system');
    console.log('✅ Connected to MongoDB');

    // Test 1: Get all courses
    console.log('\n📚 Testing courses endpoint...');
    const courses = await Course.find({ isActive: true }).select('name code description duration durationUnit');
    console.log(`Found ${courses.length} active courses:`);
    courses.forEach(course => {
      console.log(`  - ${course.name} (${course.code}) - ${course.duration} ${course.durationUnit}`);
    });

    // Test 2: Get branches for first course
    if (courses.length > 0) {
      const firstCourse = courses[0];
      console.log(`\n🔍 Testing branches endpoint for course: ${firstCourse.name} (${firstCourse._id})`);
      
      const branches = await Branch.find({ 
        course: firstCourse._id, 
        isActive: true 
      }).select('name code description');
      
      console.log(`Found ${branches.length} branches for ${firstCourse.name}:`);
      branches.forEach(branch => {
        console.log(`  - ${branch.name} (${branch.code})`);
      });
    }

    // Test 3: Test with a specific course ID
    const btechCourse = await Course.findOne({ code: 'BTECH' });
    if (btechCourse) {
      console.log(`\n🔍 Testing branches for B.Tech course (${btechCourse._id})`);
      const btechBranches = await Branch.find({ 
        course: btechCourse._id, 
        isActive: true 
      }).select('name code');
      
      console.log(`Found ${btechBranches.length} branches for B.Tech:`);
      btechBranches.forEach(branch => {
        console.log(`  - ${branch.name} (${branch.code})`);
      });
    }

    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

testEndpoints(); 