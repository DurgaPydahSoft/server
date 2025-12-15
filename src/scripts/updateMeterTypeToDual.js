import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from '../models/Room.js';
import HostelCategory from '../models/HostelCategory.js';
import Hostel from '../models/Hostel.js';

// Load environment variables
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel-management';

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`✅ Connected to MongoDB at ${MONGO_URI}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Migration: set meterType = dual for rooms whose category name is A or A+ (new hostel/category model)
const updateMeterTypeToDual = async () => {
  try {
    console.log('🔄 Starting meter type update migration (Hostel/Category aware)...');
    console.log('📋 Target categories (by name): A and A+');
    console.log('🎯 Setting meterType to: dual\n');

    // Find category ids with name A or A+
    const categories = await HostelCategory.find({ name: { $in: ['A', 'A+'] } }).select('_id name hostel');
    if (!categories.length) {
      console.log('ℹ️ No categories named A or A+ found. Nothing to update.');
      return;
    }

    const categoryIds = categories.map(c => c._id);
    const categoryNamesById = Object.fromEntries(categories.map(c => [c._id.toString(), c.name]));
    const hostelsById = Object.fromEntries(
      (await Hostel.find({ _id: { $in: categories.map(c => c.hostel).filter(Boolean) } }).select('_id name'))
        .map(h => [h._id.toString(), h.name])
    );

    // Fetch rooms in those categories (populate for logging)
    const roomsToUpdate = await Room.find({ category: { $in: categoryIds } })
      .select('_id roomNumber hostel category meterType')
      .populate('category', 'name')
      .populate('hostel', 'name');

    console.log(`📊 Found ${roomsToUpdate.length} rooms in categories A/A+`);

    if (roomsToUpdate.length === 0) {
      console.log('ℹ️ No rooms found to update.');
      return;
    }

    // Group by current meter type
    const byMeterType = roomsToUpdate.reduce((acc, room) => {
      const currentType = room.meterType || 'single';
      if (!acc[currentType]) acc[currentType] = [];
      acc[currentType].push(room);
      return acc;
    }, {});

    console.log('\n📈 Current meter type distribution (target rooms):');
    Object.entries(byMeterType).forEach(([type, rooms]) => {
      console.log(`   ${type}: ${rooms.length} rooms`);
    });

    // Sample preview
    console.log('\n📝 Sample rooms to be updated:');
    roomsToUpdate.slice(0, 10).forEach(room => {
      const catName = room.category?.name || categoryNamesById[room.category?.toString()] || room.category;
      const hostelName = room.hostel?.name || hostelsById[room.hostel?.toString()] || room.hostel;
      console.log(`   - Room ${room.roomNumber} (${hostelName || 'Hostel?'} / ${catName || 'Category?'}): ${room.meterType || 'single'} → dual`);
    });
    if (roomsToUpdate.length > 10) {
      console.log(`   ... and ${roomsToUpdate.length - 10} more rooms`);
    }

    console.log('\n⚠️  This will update all rooms whose category name is A or A+ to dual meter type.');
    console.log('⚠️  Ensure you have a backup before proceeding.\n');

    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const room of roomsToUpdate) {
      try {
        if (room.meterType === 'dual') {
          skippedCount++;
          continue;
        }
        await Room.findByIdAndUpdate(room._id, { meterType: 'dual' });
        updatedCount++;
      } catch (error) {
        errors.push({
          roomId: room._id,
          roomNumber: room.roomNumber,
          error: error.message
        });
      }
    }

    // Verify the update
    const verified = await Room.countDocuments({ category: { $in: categoryIds }, meterType: 'dual' });

    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} rooms`);
    console.log(`⏭️  Skipped (already dual): ${skippedCount} rooms`);
    console.log(`❌ Errors: ${errors.length} rooms`);
    console.log(`🔍 Verified dual meter rooms (A/A+): ${verified}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(error => {
        console.log(`   - Room ${error.roomNumber}: ${error.error}`);
      });
    }

    // Final distribution
    const finalStats = await Room.aggregate([
      { $match: { category: { $in: categoryIds } } },
      {
        $group: {
          _id: { category: '$category', meterType: '$meterType' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.category': 1, '_id.meterType': 1 } }
    ]);

    console.log('\n📈 Final meter type distribution for A and A+ categories:');
    for (const stat of finalStats) {
      const catName = categoryNamesById[stat._id.category.toString()] || stat._id.category;
      const meterType = stat._id.meterType || 'single';
      console.log(`   Category ${catName} - ${meterType}: ${stat.count} rooms`);
    }

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