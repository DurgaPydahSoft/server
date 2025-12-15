import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from '../models/Room.js';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';

// Load environment variables
dotenv.config();

// Room mappings based on original gender/category to seed into hostels/categories
const ROOM_MAPPINGS = {
  'Boys Hostel': {
    'A+': ['302', '309', '310', '311', '312'],
    'A': ['303', '304', '305', '306', '308', '320', '321', '324', '325'],
    'B': ['314', '315', '316', '317', '322', '323']
  },
  'Girls Hostel': {
    'A+': ['209', '211', '212', '213', '214', '215'],
    'A': ['103', '115', '201', '202', '203', '204', '205', '206', '207', '208', '216', '217'],
    'B': ['101', '102', '104', '105', '106', '108', '109', '111', '112', '114']
  }
};

const seedRooms = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing rooms/categories/hostels (optional reset)
    await Room.deleteMany({});
    await HostelCategory.deleteMany({});
    await Hostel.deleteMany({});
    console.log('Cleared existing hostels/categories/rooms');

    // Create hostels
    const hostelDocs = {};
    for (const hostelName of Object.keys(ROOM_MAPPINGS)) {
      hostelDocs[hostelName] = await Hostel.create({ name: hostelName, isActive: true });
    }

    // Create categories per hostel
    const categoryDocs = {};
    for (const [hostelName, categories] of Object.entries(ROOM_MAPPINGS)) {
      const hostelId = hostelDocs[hostelName]._id;
      categoryDocs[hostelName] = {};
      for (const categoryName of Object.keys(categories)) {
        categoryDocs[hostelName][categoryName] = await HostelCategory.create({
          hostel: hostelId,
          name: categoryName,
          isActive: true
        });
      }
    }

    // Create rooms array from mappings
    const rooms = [];
    for (const [hostelName, categories] of Object.entries(ROOM_MAPPINGS)) {
      const hostelId = hostelDocs[hostelName]._id;
      for (const [categoryName, roomNumbers] of Object.entries(categories)) {
        const categoryId = categoryDocs[hostelName][categoryName]._id;
        for (const roomNumber of roomNumbers) {
          rooms.push({
            hostel: hostelId,
            category: categoryId,
            roomNumber,
            isActive: true,
            bedCount: 10 // Default to 1 bed per room
          });
        }
      }
    }

    // Insert rooms
    const result = await Room.insertMany(rooms);
    console.log(`Successfully seeded ${result.length} rooms`);

    // Log room distribution
    const stats = await Room.aggregate([
      {
        $group: {
          _id: {
            hostel: '$hostel',
            category: '$category'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.hostel',
          categories: {
            $push: {
              category: '$_id.category',
              count: '$count'
            }
          },
          total: { $sum: '$count' }
        }
      }
    ]);

    console.log('\nRoom Distribution:');
    for (const hostelStat of stats) {
      const hostelName = hostelDocs && Object.values(hostelDocs).find(h => h._id.toString() === hostelStat._id.toString())?.name || hostelStat._id;
      console.log(`\n${hostelName}:`);
      for (const cat of hostelStat.categories) {
        const catName = await HostelCategory.findById(cat.category).then(c => c?.name || cat.category);
        console.log(`  Category ${catName}: ${cat.count} rooms`);
      }
      console.log(`  Total: ${hostelStat.total} rooms`);
    }

  } catch (error) {
    console.error('Error seeding rooms:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
};

// Run the seeding function
seedRooms(); 