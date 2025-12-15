import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import Room from '../models/Room.js';
import User from '../models/User.js';

dotenv.config();

/**
 * Migration:
 * - Map students to new hostel/category/room hierarchy
 * - Gender => hostel: Male -> Boys Hostel, Female -> Girls Hostel
 * - category name reuse (A+/A/B/B+/C)
 * - roomNumber match
 */
const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const boysHostel = await Hostel.findOne({ name: 'Boys Hostel' });
    const girlsHostel = await Hostel.findOne({ name: 'Girls Hostel' });
    if (!boysHostel || !girlsHostel) {
      throw new Error('Required hostels (Boys Hostel / Girls Hostel) not found. Run seedRooms first.');
    }

    const categoryCache = new Map();
    const getCategory = async (hostelId, name) => {
      const key = `${hostelId}:${name}`;
      if (categoryCache.has(key)) return categoryCache.get(key);
      const cat = await HostelCategory.findOne({ hostel: hostelId, name });
      categoryCache.set(key, cat);
      return cat;
    };

    const students = await User.find({ role: 'student' });
    let updated = 0;
    for (const student of students) {
      const hostel = student.gender === 'Female' ? girlsHostel : boysHostel;
      if (!hostel) continue;

      const categoryName = student.category || student.roomCategory || student.hostelCategory;
      const category = categoryName ? await getCategory(hostel._id, categoryName) : null;
      const room = await Room.findOne({
        hostel: hostel._id,
        category: category?._id,
        roomNumber: student.roomNumber
      });

      student.hostel = hostel._id;
      student.hostelCategory = category?._id || null;
      student.room = room?._id || null;

      // Optional: clear old roomNumber after mapping
      // student.roomNumber = undefined;

      await student.save();
      updated++;
      if (updated % 200 === 0) {
        console.log(`Updated ${updated}/${students.length}`);
      }
    }

    console.log(`✅ Migration completed. Updated ${updated} students.`);
  } catch (err) {
    console.error('❌ Migration error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected');
  }
};

run();

