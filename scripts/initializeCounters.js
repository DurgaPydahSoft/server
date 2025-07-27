import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Counter from '../src/models/Counter.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Initialize counter values based on existing hostel IDs
 * This ensures that new hostel ID generation continues from the highest existing sequence
 */
const initializeHostelCounters = async () => {
  try {
    console.log('🔧 Initializing hostel ID counters...');
    
    // Get all existing hostel IDs
    const students = await User.find({ 
      hostelId: { $exists: true, $ne: null },
      role: 'student'
    }).select('hostelId');
    
    console.log(`Found ${students.length} students with hostel IDs`);
    
    // Group by prefix and year
    const counters = {};
    
    students.forEach(student => {
      if (student.hostelId && /^(BH|GH)\d{5}$/.test(student.hostelId)) {
        const prefix = student.hostelId.substring(0, 2); // BH or GH
        const year = student.hostelId.substring(2, 4); // YY
        const sequence = parseInt(student.hostelId.substring(4)); // 3 digits
        
        const counterId = `hostel_${prefix}${year}`;
        
        if (!counters[counterId] || sequence > counters[counterId]) {
          counters[counterId] = sequence;
        }
      }
    });
    
    console.log('📊 Found counters:', counters);
    
    // Update or create counters
    for (const [counterId, maxSequence] of Object.entries(counters)) {
      await Counter.findOneAndUpdate(
        { _id: counterId },
        { sequence: maxSequence },
        { upsert: true }
      );
      console.log(`✅ Initialized counter ${counterId} with sequence ${maxSequence}`);
    }
    
    console.log('🎉 Hostel ID counters initialization completed!');
    return { success: true, countersInitialized: Object.keys(counters).length };
    
  } catch (error) {
    console.error('❌ Error initializing hostel ID counters:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get current counter values for debugging
 */
const getCounterStatus = async () => {
  try {
    const counters = await Counter.find({ _id: /^hostel_/ }).sort({ _id: 1 });
    console.log('📊 Current hostel ID counters:');
    counters.forEach(counter => {
      console.log(`  ${counter._id}: ${counter.sequence}`);
    });
    return counters;
  } catch (error) {
    console.error('❌ Error getting counter status:', error);
    return [];
  }
};

// Main execution
const main = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Initialize counters
    const result = await initializeHostelCounters();
    console.log('Result:', result);
    
    // Show current status
    await getCounterStatus();
    
    // Disconnect
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
};

// Run the script
main(); 