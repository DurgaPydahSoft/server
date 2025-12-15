import mongoose from 'mongoose';
import dotenv from 'dotenv';
import StaffGuest from '../models/StaffGuest.js';
import Room from '../models/Room.js';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';

dotenv.config();

/**
 * Migration: Map existing staff/guests to new hostel/category/room hierarchy
 * - Gender => hostel: Male -> Boys Hostel, Female -> Girls Hostel
 * - Find matching room by roomNumber and gender
 * - Assign hostelId, categoryId, roomId based on room assignment
 */
const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find default hostels
    const boysHostel = await Hostel.findOne({ name: 'Boys Hostel' });
    const girlsHostel = await Hostel.findOne({ name: 'Girls Hostel' });
    
    if (!boysHostel || !girlsHostel) {
      console.warn('⚠️  Default hostels not found. Attempting to find any hostels...');
      const allHostels = await Hostel.find({ isActive: true });
      if (allHostels.length === 0) {
        throw new Error('No active hostels found. Please create hostels first.');
      }
      console.log('Found hostels:', allHostels.map(h => h.name));
    }

    // Get all staff/guests with room assignments
    const staffGuests = await StaffGuest.find({
      type: 'staff',
      roomNumber: { $exists: true, $ne: null, $ne: '' },
      isActive: true
    });

    console.log(`Found ${staffGuests.length} staff/guests with room assignments to migrate`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const staffGuest of staffGuests) {
      try {
        // Determine hostel based on gender
        let targetHostel = null;
        if (staffGuest.gender === 'Female') {
          targetHostel = girlsHostel;
        } else if (staffGuest.gender === 'Male') {
          targetHostel = boysHostel;
        } else {
          // For 'Other' gender, try to find a suitable hostel
          // Default to boys hostel if available, otherwise first active hostel
          targetHostel = boysHostel || (await Hostel.findOne({ isActive: true }));
        }

        if (!targetHostel) {
          console.warn(`⚠️  No hostel found for staff/guest ${staffGuest.name} (${staffGuest._id}). Skipping.`);
          skipped++;
          continue;
        }

        // Find room by roomNumber and hostel
        // Try to find room in the target hostel
        const rooms = await Room.find({
          hostel: targetHostel._id,
          roomNumber: staffGuest.roomNumber
        }).populate('category');

        if (rooms.length === 0) {
          console.warn(`⚠️  Room ${staffGuest.roomNumber} not found in ${targetHostel.name} for ${staffGuest.name}. Skipping.`);
          skipped++;
          continue;
        }

        // If multiple rooms with same number, prefer one with matching category if available
        // Otherwise, use the first one
        let selectedRoom = rooms[0];
        
        // Try to match by category name if staff guest has any category info
        // (This is a best-effort match, as old system didn't have category)
        if (rooms.length > 1) {
          // For now, just use the first room
          // In future, could add logic to match by other criteria
          selectedRoom = rooms[0];
        }

        // Update staff guest with new hierarchy
        staffGuest.hostelId = targetHostel._id;
        staffGuest.categoryId = selectedRoom.category._id;
        staffGuest.roomId = selectedRoom._id;
        // Keep roomNumber for backward compatibility

        await staffGuest.save();
        updated++;

        if (updated % 50 === 0) {
          console.log(`Progress: Updated ${updated}/${staffGuests.length}`);
        }
      } catch (error) {
        console.error(`❌ Error migrating staff/guest ${staffGuest.name} (${staffGuest._id}):`, error.message);
        errors++;
      }
    }

    console.log('\n✅ Migration completed!');
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total: ${staffGuests.length}`);

    // Also update staff/guests without room assignments (set hostel based on gender)
    const staffGuestsWithoutRooms = await StaffGuest.find({
      type: 'staff',
      $or: [
        { roomNumber: { $exists: false } },
        { roomNumber: null },
        { roomNumber: '' }
      ],
      isActive: true,
      hostelId: { $exists: false }
    });

    let hostelOnlyUpdated = 0;
    for (const staffGuest of staffGuestsWithoutRooms) {
      try {
        let targetHostel = null;
        if (staffGuest.gender === 'Female') {
          targetHostel = girlsHostel;
        } else if (staffGuest.gender === 'Male') {
          targetHostel = boysHostel;
        } else {
          targetHostel = boysHostel || (await Hostel.findOne({ isActive: true }));
        }

        if (targetHostel) {
          staffGuest.hostelId = targetHostel._id;
          await staffGuest.save();
          hostelOnlyUpdated++;
        }
      } catch (error) {
        console.error(`❌ Error updating hostel for ${staffGuest.name}:`, error.message);
      }
    }

    if (hostelOnlyUpdated > 0) {
      console.log(`\n✅ Also updated ${hostelOnlyUpdated} staff/guests without rooms (hostel only)`);
    }

  } catch (err) {
    console.error('❌ Migration error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Run migration
run();

