import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import dotenv from 'dotenv';

dotenv.config();

// Migration mapping from old hardcoded values to new dynamic system
const courseMapping = {
  'B.Tech': 'BTECH',
  'Diploma': 'DIPLOMA', 
  'Pharmacy': 'PHARMACY',
  'Degree': 'DEGREE',
  'MBA': 'MBA',
  'MCA': 'MCA'
};

const branchMapping = {
  // B.Tech branches
  'CSE': 'CSE',
  'ECE': 'ECE', 
  'EEE': 'EEE',
  'MECH': 'MECH',
  'CIVIL': 'CIVIL',
  'AI': 'AI',
  'AI & ML': 'AI_ML',
  
  // Diploma branches
  'DAIML': 'DAIML',
  'DCSE': 'DCSE',
  'DECE': 'DECE', 
  'DME': 'DME',
  'DAP': 'DAP',
  'D Fisheries': 'DFISHERIES',
  'D Animal Husbandry': 'DANIMAL',
  
  // Pharmacy branches
  'B-Pharmacy': 'BPHARM',
  'Pharm D': 'PHARMD',
  'Pharm(PB) D': 'PHARMPBD',
  'Pharmaceutical Analysis': 'PHARMANALYSIS',
  'Pharmaceutics': 'PHARMACEUTICS',
  'Pharma Quality Assurance': 'PHARMQA',
  
  // Degree branches
  'Agriculture': 'AGRICULTURE',
  'Horticulture': 'HORTICULTURE',
  'Food Technology': 'FOODTECH',
  'Fisheries': 'FISHERIES',
  'Food Science & Nutrition': 'FOODSCIENCE',
  
  // MBA branches
  'Finance': 'MBA_FINANCE',
  'Marketing': 'MBA_MARKETING',
  'Human Resources': 'MBA_HR',
  'Information Technology': 'MBA_IT',
  'Operations Management': 'MBA_OPERATIONS',
  
  // MCA branches
  'Computer Applications': 'MCA_GENERAL',
  'Software Engineering': 'MCA_SOFTWARE',
  'Data Science': 'MCA_DATASCIENCE'
};

const migrateToDynamicCourses = async () => {
  try {
    console.log('🔄 Starting migration to dynamic courses and branches...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Step 1: Create courses if they don't exist
    console.log('📚 Creating courses...');
    const courseCodeMap = {};
    
    for (const [oldName, newCode] of Object.entries(courseMapping)) {
      let course = await Course.findOne({ code: newCode });
      
      if (!course) {
        // Determine duration based on course type
        let duration = 4;
        if (newCode === 'DIPLOMA' || newCode === 'DEGREE') duration = 3;
        if (newCode === 'MBA') duration = 2;
        if (newCode === 'MCA') duration = 3;
        
        course = new Course({
          name: oldName,
          code: newCode,
          description: `${oldName} program`,
          duration: duration,
          durationUnit: 'years'
        });
        
        await course.save();
        console.log(`✅ Created course: ${oldName} (${newCode})`);
      } else {
        console.log(`ℹ️ Course already exists: ${oldName} (${newCode})`);
      }
      
      courseCodeMap[oldName] = course._id;
    }
    
    // Step 2: Create branches if they don't exist
    console.log('🌿 Creating branches...');
    const branchCodeMap = {};
    
    // Group branches by course
    const branchesByCourse = {
      'B.Tech': ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AI', 'AI & ML'],
      'Diploma': ['DAIML', 'DCSE', 'DECE', 'DME', 'DAP', 'D Fisheries', 'D Animal Husbandry'],
      'Pharmacy': ['B-Pharmacy', 'Pharm D', 'Pharm(PB) D', 'Pharmaceutical Analysis', 'Pharmaceutics', 'Pharma Quality Assurance'],
      'Degree': ['Agriculture', 'Horticulture', 'Food Technology', 'Fisheries', 'Food Science & Nutrition'],
      'MBA': ['Finance', 'Marketing', 'Human Resources', 'Information Technology', 'Operations Management'],
      'MCA': ['Computer Applications', 'Software Engineering', 'Data Science']
    };
    
    for (const [courseName, branchNames] of Object.entries(branchesByCourse)) {
      const courseId = courseCodeMap[courseName];
      if (!courseId) {
        console.warn(`⚠️ Course not found for branches: ${courseName}`);
        continue;
      }
      
      for (const branchName of branchNames) {
        const branchCode = branchMapping[branchName];
        if (!branchCode) {
          console.warn(`⚠️ No mapping found for branch: ${branchName}`);
          continue;
        }
        
        let branch = await Branch.findOne({ course: courseId, code: branchCode });
        
        if (!branch) {
          branch = new Branch({
            name: branchName,
            code: branchCode,
            course: courseId,
            description: `${branchName} branch`
          });
          
          await branch.save();
          console.log(`✅ Created branch: ${branchName} (${branchCode}) for ${courseName}`);
        } else {
          console.log(`ℹ️ Branch already exists: ${branchName} (${branchCode}) for ${courseName}`);
        }
        
        branchCodeMap[branchName] = branch._id;
      }
    }
    
    // Step 3: Update existing users
    console.log('👥 Updating existing users...');
    const users = await User.find({ role: 'student' });
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const user of users) {
      try {
        const newCourseId = courseCodeMap[user.course];
        const newBranchId = branchCodeMap[user.branch];
        
        if (newCourseId && newBranchId) {
          user.course = newCourseId;
          user.branch = newBranchId;
          await user.save();
          updatedCount++;
          console.log(`✅ Updated user: ${user.rollNumber} - ${user.course} -> ${user.branch}`);
        } else {
          console.warn(`⚠️ Could not map user ${user.rollNumber}: course=${user.course}, branch=${user.branch}`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error updating user ${user.rollNumber}:`, error.message);
        skippedCount++;
      }
    }
    
    console.log('🎉 Migration completed!');
    console.log(`📊 Summary:`);
    console.log(`   - Users updated: ${updatedCount}`);
    console.log(`   - Users skipped: ${skippedCount}`);
    console.log(`   - Total users processed: ${users.length}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Run the migration
migrateToDynamicCourses(); 