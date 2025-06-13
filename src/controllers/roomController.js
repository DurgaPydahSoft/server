import Room from '../models/Room.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';

// Get all rooms with optional filtering
export const getRooms = async (req, res, next) => {
  try {
    const { gender, category } = req.query;
    const query = {};

    if (gender) query.gender = gender;
    if (category) query.category = category;

    const rooms = await Room.find(query).sort({ roomNumber: 1 });
    
    // Get student count for each room
    const roomsWithStudentCount = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        gender: room.gender,
        category: room.category,
        roomNumber: room.roomNumber,
        role: 'student'
      });
      
      return {
        ...room.toObject(),
        studentCount
      };
    }));

    res.json({
      success: true,
      data: {
        rooms: roomsWithStudentCount
      }
    });
  } catch (error) {
    next(error);
  }
};

// Add a new room
export const addRoom = async (req, res, next) => {
  try {
    const { gender, category, roomNumber, bedCount } = req.body;

    // Check if room already exists
    const existingRoom = await Room.findOne({ roomNumber });
    if (existingRoom) {
      throw createError(400, 'Room number already exists');
    }

    const room = new Room({
      gender,
      category,
      roomNumber,
      bedCount: bedCount || 1
    });

    const savedRoom = await room.save();
    res.status(201).json(savedRoom);
  } catch (error) {
    next(error);
  }
};

// Update a room
export const updateRoom = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { gender, category, roomNumber, isActive, bedCount } = req.body;

    const room = await Room.findById(id);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    // If room number is being changed, check for duplicates
    if (roomNumber && roomNumber !== room.roomNumber) {
      const existingRoom = await Room.findOne({ roomNumber });
      if (existingRoom) {
        throw createError(400, 'Room number already exists');
      }
    }

    // Update fields
    if (gender) room.gender = gender;
    if (category) room.category = category;
    if (roomNumber) room.roomNumber = roomNumber;
    if (typeof isActive === 'boolean') room.isActive = isActive;
    if (typeof bedCount === 'number' && bedCount > 0) room.bedCount = bedCount;

    const updatedRoom = await room.save();
    res.json(updatedRoom);
  } catch (error) {
    next(error);
  }
};

// Delete a room
export const deleteRoom = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if room has any students
    const room = await Room.findById(id);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    const studentCount = await User.countDocuments({
      gender: room.gender,
      category: room.category,
      roomNumber: room.roomNumber,
      role: 'student'
    });

    if (studentCount > 0) {
      throw createError(400, 'Cannot delete room with assigned students');
    }

    await Room.findByIdAndDelete(id);
    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// Get room statistics
export const getRoomStats = async (req, res, next) => {
  try {
    const stats = await Room.aggregate([
      {
        $group: {
          _id: {
            gender: '$gender',
            category: '$category'
          },
          totalRooms: { $sum: 1 },
          activeRooms: {
            $sum: { $cond: ['$isActive', 1, 0] }
          }
        }
      },
      {
        $group: {
          _id: '$_id.gender',
          categories: {
            $push: {
              category: '$_id.category',
              totalRooms: '$totalRooms',
              activeRooms: '$activeRooms'
            }
          },
          totalRooms: { $sum: '$totalRooms' },
          activeRooms: { $sum: '$activeRooms' }
        }
      }
    ]);

    res.json(stats);
  } catch (error) {
    next(error);
  }
};

// Get students in a specific room
export const getRoomStudents = async (req, res) => {
  try {
    const { roomId } = req.params;

    // Find the room
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Find all students in this room
    const students = await User.find({
      gender: room.gender,
      category: room.category,
      roomNumber: room.roomNumber,
      role: 'student'
    }).select('name rollNumber studentPhone course branch year');

    res.json({
      success: true,
      data: {
        students
      }
    });
  } catch (error) {
    console.error('Error getting room students:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting room students'
    });
  }
};

// Add or update electricity bill for a room
export const addOrUpdateElectricityBill = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { month, startUnits, endUnits, rate } = req.body;
    if (!month || typeof startUnits !== 'number' || typeof endUnits !== 'number') {
      return res.status(400).json({ success: false, message: 'Month, startUnits, and endUnits are required' });
    }
    if (endUnits < startUnits) {
      return res.status(400).json({ success: false, message: 'Ending units must be greater than or equal to starting units' });
    }
    // Parse rate as number if provided
    let billRate = Room.defaultElectricityRate;
    if (rate !== undefined && rate !== null && rate !== '') {
      const parsedRate = Number(rate);
      if (!isNaN(parsedRate)) {
        billRate = parsedRate;
        if (parsedRate !== Room.defaultElectricityRate) {
          Room.setDefaultElectricityRate(parsedRate);
        }
      }
    }
    const consumption = endUnits - startUnits;
    const total = consumption * billRate;
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    // Check if bill for this month exists
    const existingIndex = room.electricityBills.findIndex(bill => bill.month === month);
    if (existingIndex !== -1) {
      // Update existing bill
      room.electricityBills[existingIndex] = { month, startUnits, endUnits, consumption, rate: billRate, total };
    } else {
      // Add new bill
      room.electricityBills.push({ month, startUnits, endUnits, consumption, rate: billRate, total });
    }
    await room.save();
    res.json({ success: true, data: room.electricityBills });
  } catch (error) {
    next(error);
  }
};

// Get electricity bills for a room
export const getElectricityBills = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    res.json({ success: true, data: room.electricityBills });
  } catch (error) {
    next(error);
  }
};

// Get electricity bills for a student's room
export const getStudentRoomBills = async (req, res, next) => {
  try {
    const { roomNumber, gender, category } = req.user;

    // Find the room
    const room = await Room.findOne({ roomNumber, gender, category });
    if (!room) {
      return res.status(404).json({ 
        success: false, 
        message: 'Room not found' 
      });
    }

    // Sort bills by month in descending order
    const sortedBills = room.electricityBills.sort((a, b) => b.month.localeCompare(a.month));

    res.json({ 
      success: true, 
      data: sortedBills 
    });
  } catch (error) {
    next(error);
  }
};

// Get the current default electricity rate
export const getDefaultElectricityRate = (req, res) => {
  res.json({ success: true, rate: Room.defaultElectricityRate });
}; 