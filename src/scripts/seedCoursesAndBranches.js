import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import dotenv from 'dotenv';

dotenv.config();

// Initial courses data
const initialCourses = [
  {
    name: 'B.Tech',
    code: 'BTECH',
    description: 'Bachelor of Technology - 4 year engineering program',
    duration: 4,
    durationUnit: 'years'
  },
  {
    name: 'Diploma',
    code: 'DIPLOMA',
    description: 'Diploma programs - 3 year technical education',
    duration: 3,
    durationUnit: 'years'
  },
  {
    name: 'Pharmacy',
    code: 'PHARMACY',
    description: 'Pharmacy degree programs',
    duration: 4,
    durationUnit: 'years'
  },
  {
    name: 'Degree',
    code: 'DEGREE',
    description: 'General degree programs',
    duration: 3,
    durationUnit: 'years'
  }
];

// Initial branches data mapped to courses
const initialBranches = {
  BTECH: [
    { name: 'Computer Science Engineering', code: 'CSE' },
    { name: 'Electronics & Communication Engineering', code: 'ECE' },
    { name: 'Electrical & Electronics Engineering', code: 'EEE' },
    { name: 'Mechanical Engineering', code: 'MECH' },
    { name: 'Civil Engineering', code: 'CIVIL' },
    { name: 'Artificial Intelligence', code: 'AI' },
    { name: 'Artificial Intelligence & Machine Learning', code: 'AI_ML' }
  ],
  DIPLOMA: [
    { name: 'Diploma in Computer Engineering', code: 'DCME' },
    { name: 'Diploma in Electronics', code: 'DECE' },
    { name: 'Diploma in Mechanical Engineering', code: 'DMECH' },
    { name: 'Diploma in Fisheries', code: 'DFISHERIES' },
    { name: 'Diploma in Animal Husbandry', code: 'DAH' },
    { name: 'Diploma in AI & ML', code: 'DAIML' },
    { name: 'Diploma in Agriculture', code: 'DAGRI' }
  ],
  PHARMACY: [
    { name: 'B-Pharmacy', code: 'BPHARM' },
    { name: 'Pharm D', code: 'PHARMD' },
    { name: 'Pharm(PB) D', code: 'PHARMPBD' },
    { name: 'Pharmaceutical Analysis', code: 'PHARMANALYSIS' },
    { name: 'Pharmaceutics', code: 'PHARMACEUTICS' },
    { name: 'Pharma Quality Assurance', code: 'PHARMQA' }
  ],
  DEGREE: [
    { name: 'Agriculture', code: 'AGRICULTURE' },
    { name: 'Horticulture', code: 'HORTICULTURE' },
    { name: 'Food Technology', code: 'FOODTECH' },
    { name: 'Fisheries', code: 'FISHERIES' },
    { name: 'Food Science & Nutrition', code: 'FOODSCIENCE' },
    { name: 'Forensic', code: 'FORENSIC' }
  ]
};

const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seeding...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Clear existing data (optional - comment out if you want to preserve existing data)
    await Course.deleteMany({});
    await Branch.deleteMany({});
    console.log('🧹 Cleared existing courses and branches');
    
    // Insert courses
    const createdCourses = [];
    for (const courseData of initialCourses) {
      const course = new Course(courseData);
      const savedCourse = await course.save();
      createdCourses.push(savedCourse);
      console.log(`✅ Created course: ${savedCourse.name} (${savedCourse.code})`);
    }
    
    // Create a map of course codes to course IDs
    const courseCodeMap = {};
    createdCourses.forEach(course => {
      courseCodeMap[course.code] = course._id;
    });
    
    // Insert branches
    for (const [courseCode, branches] of Object.entries(initialBranches)) {
      const courseId = courseCodeMap[courseCode];
      if (!courseId) {
        console.warn(`⚠️ Course code ${courseCode} not found, skipping branches`);
        continue;
      }
      
      for (const branchData of branches) {
        const branch = new Branch({
          ...branchData,
          course: courseId,
          isActive: true
        });
        const savedBranch = await branch.save();
        console.log(`✅ Created branch: ${savedBranch.name} (${savedBranch.code}) for course ${courseCode}`);
      }
    }
    
    console.log('🎉 Database seeding completed successfully!');
    
    // Display summary
    const totalCourses = await Course.countDocuments();
    const totalBranches = await Branch.countDocuments();
    console.log(`📊 Summary: ${totalCourses} courses and ${totalBranches} branches created`);
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Run the seed function
seedDatabase(); 