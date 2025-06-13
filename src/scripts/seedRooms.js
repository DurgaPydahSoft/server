import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from '../models/Room.js';

// Load environment variables
dotenv.config();

// Room mappings based on gender and category
const ROOM_MAPPINGS = {
  Male: {
    'A+': ['302', '309', '310', '311', '312'],  // AC Rooms
    'A': ['303', '304', '305', '306', '308', '320', '324', '325'],  // Standard Rooms
    'B+': ['321'],  // AC Room
    'B': ['314', '315', '316', '317', '322', '323']  // Standard Rooms
  },
  Female: {
    'A+': ['209', '211', '212', '213', '214', '215'],  // AC Rooms
    'A': ['103', '115', '201', '202', '203', '204', '205', '206', '207', '208', '216', '217'],  // Standard Rooms
    'B': ['101', '102', '104', '105', '106', '108', '109', '111', '112', '114'],  // Standard Rooms
    'C': ['117']  // Standard Room
  }
};

const seedRooms = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing rooms
    await Room.deleteMany({});
    console.log('Cleared existing rooms');

    // Create rooms array from mappings
    const rooms = [];
    for (const [gender, categories] of Object.entries(ROOM_MAPPINGS)) {
      for (const [category, roomNumbers] of Object.entries(categories)) {
        for (const roomNumber of roomNumbers) {
          rooms.push({
            gender,
            category,
            roomNumber,
            isActive: true,
            bedCount: 1 // Default to 1 bed per room
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
            gender: '$gender',
            category: '$category'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.gender',
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
    stats.forEach(gender => {
      console.log(`\n${gender._id}:`);
      gender.categories.forEach(cat => {
        console.log(`  Category ${cat.category}: ${cat.count} rooms`);
      });
      console.log(`  Total: ${gender.total} rooms`);
    });

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