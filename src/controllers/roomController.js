import Room from '../models/Room.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import { createError } from '../utils/error.js';

// Get all rooms with optional filtering
export const getRooms = async (req, res, next) => {
  try {
    const { gender, category, includeLastBill } = req.query;
    const query = {};

    if (gender) query.gender = gender;
    if (category) query.category = category;

    const rooms = await Room.find(query).sort({ roomNumber: 1 });
    
    // Get student count for each room and optionally the last bill
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        gender: room.gender,
        category: room.category,
        roomNumber: room.roomNumber,
        role: 'student'
      });
      
      const roomObject = room.toObject();

      if (includeLastBill === 'true' && roomObject.electricityBills?.length > 0) {
        // Sort by month to find the latest bill
        roomObject.lastBill = [...roomObject.electricityBills].sort((a, b) => b.month.localeCompare(a.month))[0];
      }

      return {
        ...roomObject,
        studentCount
      };
    }));

    res.json({
      success: true,
      data: {
        rooms: roomsWithDetails
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get rooms for warden with hostel type filtering
export const getWardenRooms = async (req, res, next) => {
  try {
    const { gender, category, includeLastBill } = req.query;
    const warden = req.warden;
    
    // Filter rooms based on warden's hostel type
    const query = {};
    
    // Map hostel type to gender
    if (warden.hostelType) {
      const hostelType = warden.hostelType.toLowerCase();
      if (hostelType === 'boys') {
        query.gender = 'Male';
      } else if (hostelType === 'girls') {
        query.gender = 'Female';
      }
    }
    
    if (gender) query.gender = gender;
    if (category) query.category = category;

    const rooms = await Room.find(query).sort({ roomNumber: 1 });
    
    // Get student count for each room and optionally the last bill
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        gender: room.gender,
        category: room.category,
        roomNumber: room.roomNumber,
        role: 'student'
      });
      
      const roomObject = room.toObject();

      if (includeLastBill === 'true' && roomObject.electricityBills?.length > 0) {
        // Sort by month to find the latest bill
        roomObject.lastBill = [...roomObject.electricityBills].sort((a, b) => b.month.localeCompare(a.month))[0];
      }

      return {
        ...roomObject,
        studentCount
      };
    }));

    res.json({
      success: true,
      data: {
        rooms: roomsWithDetails
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
    // Get room statistics with bed counts
    const roomStats = await Room.aggregate([
      {
        $group: {
          _id: {
            gender: '$gender',
            category: '$category'
          },
          totalRooms: { $sum: 1 },
          activeRooms: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          totalBeds: { $sum: '$bedCount' }
        }
      },
      {
        $group: {
          _id: '$_id.gender',
          categories: {
            $push: {
              category: '$_id.category',
              totalRooms: '$totalRooms',
              activeRooms: '$activeRooms',
              totalBeds: '$totalBeds'
            }
          },
          totalRooms: { $sum: '$totalRooms' },
          activeRooms: { $sum: '$activeRooms' },
          totalBeds: { $sum: '$totalBeds' }
        }
      }
    ]);

    // Get student counts (filled beds) by gender and category
    const studentStats = await User.aggregate([
      {
        $match: { role: 'student' }
      },
      {
        $group: {
          _id: {
            gender: '$gender',
            category: '$category'
          },
          filledBeds: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.gender',
          categories: {
            $push: {
              category: '$_id.category',
              filledBeds: '$filledBeds'
            }
          },
          filledBeds: { $sum: '$filledBeds' }
        }
      }
    ]);

    // Combine room and student stats
    const combinedStats = roomStats.map(roomStat => {
      const studentStat = studentStats.find(s => s._id === roomStat._id);
      
      // Merge category stats
      const mergedCategories = roomStat.categories.map(roomCategory => {
        const studentCategory = studentStat?.categories.find(s => s.category === roomCategory.category);
        return {
          ...roomCategory,
          filledBeds: studentCategory?.filledBeds || 0,
          availableBeds: roomCategory.totalBeds - (studentCategory?.filledBeds || 0)
        };
      });

      return {
        gender: roomStat._id,
        totalRooms: roomStat.totalRooms,
        activeRooms: roomStat.activeRooms,
        totalBeds: roomStat.totalBeds,
        filledBeds: studentStat?.filledBeds || 0,
        availableBeds: roomStat.totalBeds - (studentStat?.filledBeds || 0),
        categories: mergedCategories
      };
    });

    // Calculate overall totals
    const overallStats = {
      totalRooms: combinedStats.reduce((sum, stat) => sum + stat.totalRooms, 0),
      activeRooms: combinedStats.reduce((sum, stat) => sum + stat.activeRooms, 0),
      totalBeds: combinedStats.reduce((sum, stat) => sum + stat.totalBeds, 0),
      filledBeds: combinedStats.reduce((sum, stat) => sum + stat.filledBeds, 0),
      availableBeds: combinedStats.reduce((sum, stat) => sum + stat.availableBeds, 0)
    };

    res.json({
      success: true,
      data: {
        overall: overallStats,
        byGender: combinedStats
      }
    });
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
    })
      .select('name rollNumber studentPhone course branch year')
      .populate('course', 'name code')
      .populate('branch', 'name code');

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

    // Data migration: Ensure all bills have a consumption value before saving
    room.electricityBills.forEach(bill => {
      if (bill.consumption === undefined || bill.consumption === null) {
        bill.consumption = bill.endUnits - bill.startUnits;
      }
    });
    
    await room.save();
    res.json({ success: true, data: room.electricityBills });
  } catch (error) {
    next(error);
  }
};

// Bulk add or update electricity bills for multiple rooms
export const addBulkElectricityBills = async (req, res, next) => {
  try {
    const { month, bills } = req.body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw createError(400, 'A valid month in YYYY-MM format is required.');
    }

    if (!bills || !Array.isArray(bills) || bills.length === 0) {
      throw createError(400, 'A non-empty array of bills is required.');
    }

    const bulkOps = [];
    const defaultRate = Room.defaultElectricityRate;

    for (const billData of bills) {
      const { roomId, startUnits, endUnits, rate } = billData;

      // Basic validation for each bill entry
      if (!roomId || startUnits === undefined || endUnits === undefined) {
        continue; // Skip entries that are not fully filled
      }
      
      const start = Number(startUnits);
      const end = Number(endUnits);

      if (isNaN(start) || isNaN(end) || end < start) {
        console.warn(`Skipping invalid bill data for room ${roomId}: start=${start}, end=${end}`);
        continue;
      }

      const billRate = (rate !== undefined && rate !== null && !isNaN(Number(rate))) ? Number(rate) : defaultRate;
      const consumption = end - start;
      const total = consumption * billRate;

      const newBillPayload = {
        month,
        startUnits: start,
        endUnits: end,
        consumption,
        rate: billRate,
        total,
        createdAt: new Date()
      };
      
      // Upsert logic: Pull the old bill for the month and push the new one
      bulkOps.push({
        updateOne: {
          filter: { _id: roomId },
          update: { $pull: { electricityBills: { month: month } } }
        }
      });
      bulkOps.push({
        updateOne: {
          filter: { _id: roomId },
          update: { $push: { electricityBills: newBillPayload } }
        }
      });
    }

    if (bulkOps.length > 0) {
      await Room.bulkWrite(bulkOps);
    }

    res.status(200).json({
      success: true,
      message: `Processed ${bulkOps.length / 2} bills successfully.`,
    });

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
    const { _id, roomNumber, gender, category } = req.user;

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

    // Get current student count for the room
    const studentsInRoom = await User.countDocuments({
      roomNumber: room.roomNumber,
      gender: room.gender,
      category: room.category,
      role: 'student',
      hostelStatus: 'Active'
    });

    // For each bill, find the student's share and check payment status
    const studentBills = await Promise.all(sortedBills.map(async (bill) => {
      const studentBill = bill.studentBills?.find(sb => sb.studentId.toString() === _id.toString());
      
      // If no studentBills array exists (old bills), calculate equal share
      let studentShare = null;
      let paymentStatus = 'unpaid';
      let paymentId = null;
      let paidAt = null;
      
      if (studentBill) {
        // New format - has studentBills array
        studentShare = studentBill.amount;
        paymentStatus = studentBill.paymentStatus;
        paymentId = studentBill.paymentId;
        paidAt = studentBill.paidAt;
      } else if (bill.studentBills && bill.studentBills.length > 0) {
        // Bill has studentBills but this student is not in it
        studentShare = null;
        paymentStatus = 'unpaid';
      } else {
        // Old bill without studentBills - calculate equal share and check payment status
        studentShare = studentsInRoom > 0 ? Math.round(bill.total / studentsInRoom) : null;
        
        // Check if student has paid for this bill by looking at Payment records
        const payment = await Payment.findOne({
          studentId: _id,
          paymentType: 'electricity',
          billId: bill._id,
          roomId: room._id,
          status: 'success'
        });
        
        if (payment) {
          paymentStatus = 'paid';
          paymentId = payment._id;
          paidAt = payment.paymentDate;
        } else {
          // Check if there's a pending payment that failed
          const failedPayment = await Payment.findOne({
            studentId: _id,
            paymentType: 'electricity',
            billId: bill._id,
            roomId: room._id,
            status: 'failed'
          });
          
          if (failedPayment) {
            // If there's a failed payment, show as unpaid
            paymentStatus = 'unpaid';
          }
        }
      }
      
      return {
        _id: bill._id,
        month: bill.month,
        startUnits: bill.startUnits,
        endUnits: bill.endUnits,
        consumption: bill.consumption,
        rate: bill.rate,
        total: bill.total,
        studentShare: studentShare,
        paymentStatus: paymentStatus,
        paymentId: paymentId,
        paidAt: paidAt
      };
    }));

    res.json({ 
      success: true, 
      data: studentBills 
    });
  } catch (error) {
    next(error);
  }
};

// Get the current default electricity rate
export const getDefaultElectricityRate = (req, res) => {
  res.json({ success: true, rate: Room.defaultElectricityRate });
}; 

// Get room payment statistics
export const getRoomPaymentStats = async (req, res) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0, 7);

    // Get current month payment status for all rooms
    const currentMonthStats = await Room.aggregate([
      {
        $unwind: '$electricityBills'
      },
      {
        $match: {
          'electricityBills.month': currentMonth
        }
      },
      {
        $group: {
          _id: {
            roomNumber: '$roomNumber',
            gender: '$gender',
            category: '$category'
          },
          paymentStatus: { $first: '$electricityBills.paymentStatus' },
          billAmount: { $first: '$electricityBills.total' },
          billMonth: { $first: '$electricityBills.month' }
        }
      },
      {
        $group: {
          _id: '$paymentStatus',
          rooms: { $push: '$$ROOT' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$billAmount' }
        }
      }
    ]);

    // Get previous month payment status
    const prevMonth = new Date();
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const previousMonth = prevMonth.toISOString().slice(0, 7);

    const previousMonthStats = await Room.aggregate([
      {
        $unwind: '$electricityBills'
      },
      {
        $match: {
          'electricityBills.month': previousMonth
        }
      },
      {
        $group: {
          _id: {
            roomNumber: '$roomNumber',
            gender: '$gender',
            category: '$category'
          },
          paymentStatus: { $first: '$electricityBills.paymentStatus' },
          billAmount: { $first: '$electricityBills.total' },
          billMonth: { $first: '$electricityBills.month' }
        }
      },
      {
        $group: {
          _id: '$paymentStatus',
          rooms: { $push: '$$ROOT' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$billAmount' }
        }
      }
    ]);

    // Get overall payment summary
    const paymentSummary = await Room.aggregate([
      {
        $unwind: '$electricityBills'
      },
      {
        $match: {
          'electricityBills.month': { $in: [currentMonth, previousMonth] }
        }
      },
      {
        $group: {
          _id: {
            month: '$electricityBills.month',
            status: '$electricityBills.paymentStatus'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$electricityBills.total' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        currentMonth: {
          month: currentMonth,
          stats: currentMonthStats
        },
        previousMonth: {
          month: previousMonth,
          stats: previousMonthStats
        },
        summary: paymentSummary
      }
    });

  } catch (error) {
    console.error('Error getting room payment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get room payment statistics',
      error: error.message
    });
  }
};

// Get current month payments
export const getCurrentMonthPayments = async (req, res) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);

    const payments = await Room.aggregate([
      {
        $unwind: '$electricityBills'
      },
      {
        $match: {
          'electricityBills.month': currentMonth
        }
      },
      {
        $group: {
          _id: {
            roomNumber: '$roomNumber',
            gender: '$gender',
            category: '$category'
          },
          paymentStatus: { $first: '$electricityBills.paymentStatus' },
          billAmount: { $first: '$electricityBills.total' },
          billMonth: { $first: '$electricityBills.month' },
          paidAt: { $first: '$electricityBills.paidAt' }
        }
      },
      {
        $sort: { '_id.roomNumber': 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        month: currentMonth,
        payments
      }
    });

  } catch (error) {
    console.error('Error getting current month payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get current month payments',
      error: error.message
    });
  }
};

// Get previous month payments
export const getPreviousMonthPayments = async (req, res) => {
  try {
    const prevMonth = new Date();
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const previousMonth = prevMonth.toISOString().slice(0, 7);

    const payments = await Room.aggregate([
      {
        $unwind: '$electricityBills'
      },
      {
        $match: {
          'electricityBills.month': previousMonth
        }
      },
      {
        $group: {
          _id: {
            roomNumber: '$roomNumber',
            gender: '$gender',
            category: '$category'
          },
          paymentStatus: { $first: '$electricityBills.paymentStatus' },
          billAmount: { $first: '$electricityBills.total' },
          billMonth: { $first: '$electricityBills.month' },
          paidAt: { $first: '$electricityBills.paidAt' }
        }
      },
      {
        $sort: { '_id.roomNumber': 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        month: previousMonth,
        payments
      }
    });

  } catch (error) {
    console.error('Error getting previous month payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get previous month payments',
      error: error.message
    });
  }
}; 

// Get rooms with bed availability for student registration
export const getRoomsWithBedAvailability = async (req, res, next) => {
  try {
    const { gender, category } = req.query;
    const query = {};

    if (gender) query.gender = gender;
    if (category) query.category = category;

    const rooms = await Room.find(query).sort({ roomNumber: 1 });
    
    // Get student count for each room
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        gender: room.gender,
        category: room.category,
        roomNumber: room.roomNumber,
        role: 'student'
      });
      
      const roomObject = room.toObject();
      const availableBeds = room.bedCount - studentCount;
      
      return {
        ...roomObject,
        studentCount,
        availableBeds,
        occupancyRate: Math.round((studentCount / room.bedCount) * 100)
      };
    }));

    res.json({
      success: true,
      data: {
        rooms: roomsWithDetails
      }
    });
  } catch (error) {
    next(error);
  }
};