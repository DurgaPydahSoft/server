import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from '../models/Room.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Migration function to update meter type to dual for A and A+ category rooms
const updateMeterTypeToDual = async () => {
  try {
    console.log('🔄 Starting meter type update migration...');
    console.log('📋 Target categories: A and A+');
    console.log('🎯 Setting meterType to: dual\n');
    
    // Find all rooms with category A or A+
    const roomsToUpdate = await Room.find({
      category: { $in: ['A', 'A+'] }
    }).select('_id roomNumber gender category meterType');
    
    console.log(`📊 Found ${roomsToUpdate.length} rooms with category A or A+`);
    
    if (roomsToUpdate.length === 0) {
      console.log('ℹ️ No rooms found to update.');
      return;
    }
    
    // Group by current meter type
    const byMeterType = roomsToUpdate.reduce((acc, room) => {
      const currentType = room.meterType || 'single';
      if (!acc[currentType]) {
        acc[currentType] = [];
      }
      acc[currentType].push(room);
      return acc;
    }, {});
    
    console.log('\n📈 Current meter type distribution:');
    Object.entries(byMeterType).forEach(([type, rooms]) => {
      console.log(`   ${type}: ${rooms.length} rooms`);
    });
    
    // Show sample rooms
    console.log('\n📝 Sample rooms to be updated:');
    roomsToUpdate.slice(0, 10).forEach(room => {
      console.log(`   - Room ${room.roomNumber} (${room.gender}/${room.category}): ${room.meterType || 'single'} → dual`);
    });
    if (roomsToUpdate.length > 10) {
      console.log(`   ... and ${roomsToUpdate.length - 10} more rooms`);
    }
    
    // Ask for confirmation (in production, you might want to add a confirmation prompt)
    console.log('\n⚠️  This will update all A and A+ category rooms to dual meter type.');
    console.log('⚠️  Make sure you have a backup before proceeding.\n');
    
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];
    
    // Update each room
    for (const room of roomsToUpdate) {
      try {
        // Skip if already dual
        if (room.meterType === 'dual') {
          console.log(`⏭️  Room ${room.roomNumber} already has dual meter type, skipping...`);
          skippedCount++;
          continue;
        }
        
        // Update the room
        await Room.findByIdAndUpdate(room._id, {
          meterType: 'dual'
        });
        
        console.log(`✅ Updated Room ${room.roomNumber} (${room.gender}/${room.category}): ${room.meterType || 'single'} → dual`);
        updatedCount++;
        
      } catch (error) {
        console.error(`❌ Error updating room ${room.roomNumber}:`, error.message);
        errors.push({
          roomId: room._id,
          roomNumber: room.roomNumber,
          error: error.message
        });
      }
    }
    
    // Verify the update
    console.log('\n🔍 Verifying updates...');
    const updatedRooms = await Room.find({
      category: { $in: ['A', 'A+'] },
      meterType: 'dual'
    }).countDocuments();
    
    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} rooms`);
    console.log(`⏭️  Skipped (already dual): ${skippedCount} rooms`);
    console.log(`❌ Errors: ${errors.length} rooms`);
    console.log(`🔍 Verified dual meter rooms: ${updatedRooms} rooms`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(error => {
        console.log(`   - Room ${error.roomNumber}: ${error.error}`);
      });
    }
    
    // Show final distribution
    const finalStats = await Room.aggregate([
      {
        $match: {
          category: { $in: ['A', 'A+'] }
        }
      },
      {
        $group: {
          _id: {
            category: '$category',
            meterType: '$meterType'
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.category': 1, '_id.meterType': 1 }
      }
    ]);
    
    console.log('\n📈 Final meter type distribution for A and A+ categories:');
    finalStats.forEach(stat => {
      const meterType = stat._id.meterType || 'single';
      console.log(`   Category ${stat._id.category} - ${meterType}: ${stat.count} rooms`);
    });
    
    console.log('\n🎉 Meter type update migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await updateMeterTypeToDual();
  } catch (error) {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();

