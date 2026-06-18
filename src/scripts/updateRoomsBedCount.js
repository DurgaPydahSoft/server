import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from '../models/Room.js';
import HostelCategory from '../models/HostelCategory.js';
import Hostel from '../models/Hostel.js';

dotenv.config();

// Default to dry-run unless --execute flag is passed
const dryRun = !process.argv.includes('--execute');

const updateAllRooms = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not defined in the environment or .env file');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Mappings of category names to target bed counts
    const countRules = [
      { names: ['A', 'A+', 'a', 'a+'], targetBeds: 5 },
      { names: ['B', 'B+', 'b', 'b+'], targetBeds: 9 }
    ];

    let totalRoomsToProcess = 0;
    let totalRoomsToChange = 0;
    const updates = [];

    for (const rule of countRules) {
      // Find category documents matching the names
      const categories = await HostelCategory.find({
        name: { $in: rule.names }
      }).populate('hostel');

      if (categories.length === 0) {
        console.log(`No categories found matching: ${rule.names.join(', ')}`);
        continue;
      }

      const categoryIds = categories.map(cat => cat._id);

      // Find rooms matching these categories
      const rooms = await Room.find({
        category: { $in: categoryIds }
      }).populate('hostel').populate('category');

      console.log(`\nCategory Group: ${rule.names.join(', ')} (Target beds: ${rule.targetBeds})`);
      console.log(`Found ${rooms.length} rooms.`);

      rooms.forEach(room => {
        totalRoomsToProcess++;
        const currentBeds = room.bedCount || 0;
        if (currentBeds !== rule.targetBeds) {
          totalRoomsToChange++;
          console.log(`  - Room ${room.roomNumber} (${room.hostel?.name || 'Unknown'}, Cat: ${room.category?.name}): bedCount ${currentBeds} -> ${rule.targetBeds}`);
          updates.push({
            roomId: room._id,
            roomNumber: room.roomNumber,
            hostelName: room.hostel?.name,
            categoryName: room.category?.name,
            from: currentBeds,
            to: rule.targetBeds
          });
        } else {
          console.log(`  - Room ${room.roomNumber} (${room.hostel?.name || 'Unknown'}, Cat: ${room.category?.name}): bedCount is already ${currentBeds}`);
        }
      });
    }

    if (totalRoomsToChange === 0) {
      console.log('\nAll rooms already have the correct bed counts. No changes needed.');
      return;
    }

    if (dryRun) {
      console.log(`\n[DRY RUN] Would update ${totalRoomsToChange} of ${totalRoomsToProcess} rooms.`);
      console.log('To apply these changes, run the script with --execute flag.');
    } else {
      console.log(`\n[EXECUTE] Applying updates for ${totalRoomsToChange} rooms...`);
      let updatedCount = 0;
      for (const update of updates) {
        await Room.updateOne({ _id: update.roomId }, { $set: { bedCount: update.to } });
        updatedCount++;
      }
      console.log(`Successfully updated ${updatedCount} rooms.`);
    }

  } catch (error) {
    console.error('Error running script:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
};

updateAllRooms();
