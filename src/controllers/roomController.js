import Room from '../models/Room.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import StaffGuest from '../models/StaffGuest.js';
import NOC from '../models/NOC.js';
import { createError } from '../utils/error.js';

// Get all rooms with optional filtering
export const getRooms = async (req, res, next) => {
  try {
    const { gender, category, includeLastBill } = req.query;
    const query = {};

    if (gender) query.gender = gender;
    if (category) query.category = category;

    const rooms = await Room.find(query).sort({ roomNumber: 1 });
    
    // Get student count and staff count for each room and optionally the last bill
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        gender: room.gender,
        category: room.category,
        roomNumber: room.roomNumber,
        role: 'student',
        hostelStatus: 'Active'
      });
      
      // Count staff in the room
      const staffCount = await StaffGuest.countDocuments({
        type: 'staff',
        gender: room.gender,
        roomNumber: room.roomNumber,
        isActive: true
      });
      
      const roomObject = room.toObject();

      if (includeLastBill === 'true' && roomObject.electricityBills?.length > 0) {
        // Sort by month to find the latest bill
        roomObject.lastBill = [...roomObject.electricityBills].sort((a, b) => b.month.localeCompare(a.month))[0];
      }

      return {
        ...roomObject,
        studentCount,
        staffCount,
        totalOccupancy: studentCount + staffCount
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
    
    // Get student count and staff count for each room and optionally the last bill
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        gender: room.gender,
        category: room.category,
        roomNumber: room.roomNumber,
        role: 'student',
        hostelStatus: 'Active'
      });
      
      // Count staff in the room
      const staffCount = await StaffGuest.countDocuments({
        type: 'staff',
        gender: room.gender,
        roomNumber: room.roomNumber,
        isActive: true
      });
      
      const roomObject = room.toObject();

      if (includeLastBill === 'true' && roomObject.electricityBills?.length > 0) {
        // Sort by month to find the latest bill
        roomObject.lastBill = [...roomObject.electricityBills].sort((a, b) => b.month.localeCompare(a.month))[0];
      }

      return {
        ...roomObject,
        studentCount,
        staffCount,
        totalOccupancy: studentCount + staffCount
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
    const { gender, category, roomNumber, bedCount, meterType } = req.body;

    // Check if room already exists
    const existingRoom = await Room.findOne({ roomNumber });
    if (existingRoom) {
      throw createError(400, 'Room number already exists');
    }

    const room = new Room({
      gender,
      category,
      roomNumber,
      bedCount: bedCount || 1,
      meterType: meterType || 'single' // Default to single meter
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
    const { gender, category, roomNumber, isActive, bedCount, meterType } = req.body;

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
    if (meterType && ['single', 'dual'].includes(meterType)) room.meterType = meterType;

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
      role: 'student',
      hostelStatus: 'Active'
    })
      .select('name rollNumber studentPhone course branch year')
      .populate('course', 'name code')
      .populate('branch', 'name code');

    // Find all staff members in this room
    const StaffGuest = (await import('../models/StaffGuest.js')).default;
    const staff = await StaffGuest.find({
      type: 'staff',
      gender: room.gender,
      roomNumber: room.roomNumber,
      isActive: true
    })
      .select('name type profession phoneNumber email department roomNumber bedNumber stayType selectedMonth checkinDate checkoutDate')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        students,
        staff
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
    const { 
      month, 
      startUnits, 
      endUnits, 
      rate,
      // Dual meter fields
      meter1StartUnits,
      meter1EndUnits,
      meter2StartUnits,
      meter2EndUnits
    } = req.body;

    if (!month) {
      return res.status(400).json({ success: false, message: 'Month is required' });
    }

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const isDualMeter = room.meterType === 'dual';
    let consumption, total, billData;

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

    if (isDualMeter) {
      // Dual meter mode
      if (typeof meter1StartUnits !== 'number' || typeof meter1EndUnits !== 'number' ||
          typeof meter2StartUnits !== 'number' || typeof meter2EndUnits !== 'number') {
        return res.status(400).json({ 
          success: false, 
          message: 'All dual meter readings (meter1StartUnits, meter1EndUnits, meter2StartUnits, meter2EndUnits) are required' 
        });
      }

      if (meter1EndUnits < meter1StartUnits) {
        return res.status(400).json({ 
          success: false, 
          message: 'Meter 1 ending units must be greater than or equal to starting units' 
        });
      }

      if (meter2EndUnits < meter2StartUnits) {
        return res.status(400).json({ 
          success: false, 
          message: 'Meter 2 ending units must be greater than or equal to starting units' 
        });
      }

      const meter1Consumption = meter1EndUnits - meter1StartUnits;
      const meter2Consumption = meter2EndUnits - meter2StartUnits;
      consumption = meter1Consumption + meter2Consumption;
      total = consumption * billRate;

      billData = {
        month,
        meter1StartUnits,
        meter1EndUnits,
        meter1Consumption,
        meter2StartUnits,
        meter2EndUnits,
        meter2Consumption,
        consumption,
        rate: billRate,
        total
      };
    } else {
      // Single meter mode (backward compatible)
      if (typeof startUnits !== 'number' || typeof endUnits !== 'number') {
        return res.status(400).json({ success: false, message: 'Month, startUnits, and endUnits are required' });
      }

      if (endUnits < startUnits) {
        return res.status(400).json({ success: false, message: 'Ending units must be greater than or equal to starting units' });
      }

      consumption = endUnits - startUnits;
      total = consumption * billRate;

      billData = {
        month,
        startUnits,
        endUnits,
        consumption,
        rate: billRate,
        total
      };
    }

    // Check if bill for this month exists
    const existingIndex = room.electricityBills.findIndex(bill => bill.month === month);
    if (existingIndex !== -1) {
      // Update existing bill - preserve other fields like studentBills, paymentStatus, etc.
      const existingBill = room.electricityBills[existingIndex];
      room.electricityBills[existingIndex] = {
        ...existingBill.toObject(),
        ...billData
      };
    } else {
      // Add new bill
      room.electricityBills.push(billData);
    }

    // Data migration: Ensure all bills have a consumption value before saving
    room.electricityBills.forEach(bill => {
      if (bill.consumption === undefined || bill.consumption === null) {
        if (bill.meter1Consumption !== undefined && bill.meter2Consumption !== undefined) {
          bill.consumption = bill.meter1Consumption + bill.meter2Consumption;
        } else if (bill.endUnits !== undefined && bill.startUnits !== undefined) {
          bill.consumption = bill.endUnits - bill.startUnits;
        }
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
      const { 
        roomId, 
        startUnits, 
        endUnits, 
        rate,
        // Dual meter fields
        meter1StartUnits,
        meter1EndUnits,
        meter2StartUnits,
        meter2EndUnits
      } = billData;

      if (!roomId) {
        continue; // Skip entries without roomId
      }

      // Fetch room to check meter type
      const room = await Room.findById(roomId);
      if (!room) {
        console.warn(`Room ${roomId} not found, skipping`);
        continue;
      }

      const isDualMeter = room.meterType === 'dual';
      let consumption, total, newBillPayload;

      const billRate = (rate !== undefined && rate !== null && !isNaN(Number(rate))) ? Number(rate) : defaultRate;

      if (isDualMeter) {
        // Dual meter mode
        if (meter1StartUnits === undefined || meter1EndUnits === undefined ||
            meter2StartUnits === undefined || meter2EndUnits === undefined) {
          continue; // Skip entries that are not fully filled
        }

        const m1Start = Number(meter1StartUnits);
        const m1End = Number(meter1EndUnits);
        const m2Start = Number(meter2StartUnits);
        const m2End = Number(meter2EndUnits);

        if (isNaN(m1Start) || isNaN(m1End) || isNaN(m2Start) || isNaN(m2End) ||
            m1End < m1Start || m2End < m2Start) {
          console.warn(`Skipping invalid dual meter bill data for room ${roomId}`);
          continue;
        }

        const meter1Consumption = m1End - m1Start;
        const meter2Consumption = m2End - m2Start;
        consumption = meter1Consumption + meter2Consumption;
        total = consumption * billRate;

        newBillPayload = {
          month,
          meter1StartUnits: m1Start,
          meter1EndUnits: m1End,
          meter1Consumption,
          meter2StartUnits: m2Start,
          meter2EndUnits: m2End,
          meter2Consumption,
          consumption,
          rate: billRate,
          total,
          createdAt: new Date()
        };
      } else {
        // Single meter mode (backward compatible)
        if (startUnits === undefined || endUnits === undefined) {
          continue; // Skip entries that are not fully filled
        }

        const start = Number(startUnits);
        const end = Number(endUnits);

        if (isNaN(start) || isNaN(end) || end < start) {
          console.warn(`Skipping invalid bill data for room ${roomId}: start=${start}, end=${end}`);
          continue;
        }

        consumption = end - start;
        total = consumption * billRate;

        newBillPayload = {
          month,
          startUnits: start,
          endUnits: end,
          consumption,
          rate: billRate,
          total,
          createdAt: new Date()
        };
      }
      
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
        
        // Adjust for NOC calculated bill if applicable
        if (studentShare !== null) {
          try {
            // Check if student has a NOC with calculated electricity bill
            const nocRequest = await NOC.findOne({
              student: _id,
              'calculatedElectricityBill.total': { $exists: true, $ne: null },
              status: { $in: ['Ready for Deactivation', 'Approved'] }
            }).sort({ 'calculatedElectricityBill.calculatedAt': -1 }); // Get the most recent one

            if (nocRequest && nocRequest.calculatedElectricityBill) {
              const billMonth = new Date(bill.month + '-01');
              const billMonthEnd = new Date(billMonth.getFullYear(), billMonth.getMonth() + 1, 0);
              
              const nocBillStart = new Date(nocRequest.calculatedElectricityBill.billPeriodStart);
              const nocBillEnd = new Date(nocRequest.calculatedElectricityBill.billPeriodEnd);
              
              // Check if the bill month overlaps with NOC bill period
              if (billMonth <= nocBillEnd && billMonthEnd >= nocBillStart) {
                // Calculate the overlap amount
                // If the bill month is within or overlaps with NOC period, subtract the NOC amount
                // Use studentShare if available (new format), otherwise fall back to total (backward compatibility)
                const nocAmount = nocRequest.calculatedElectricityBill.studentShare || nocRequest.calculatedElectricityBill.total || 0;
                
                // Only subtract if the student hasn't already been adjusted for this NOC
                // Check if this bill month is before or equal to the NOC vacating date month
                if (billMonth <= nocBillEnd) {
                  studentShare = Math.max(0, studentShare - nocAmount);
                  console.log(`📊 Adjusted student bill for ${_id}: Subtracted NOC amount ₹${nocAmount} from share ₹${studentShare + nocAmount}, new share: ₹${studentShare}`);
                }
              }
            }
          } catch (nocError) {
            console.error('Error checking NOC bill adjustment:', nocError);
            // Continue with original calculation if NOC check fails
          }
        }
        
        // Check if student has paid for this bill by looking at Payment records
        const payment = await Payment.findOne({
          studentId: _id,
          paymentType: 'electricity',
          billId: bill._id,
          roomId: room._id,
          status: 'success'
        });
        
        console.log('🔍 Checking payment for bill:', bill._id, 'student:', _id);
        console.log('🔍 Payment found:', !!payment);
        if (payment) {
          console.log('🔍 Payment details:', {
            paymentId: payment._id,
            amount: payment.amount,
            status: payment.status,
            paymentDate: payment.paymentDate
          });
        }
        
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
      
      // Check for NOC adjustment even if studentBill exists (in case bill was recalculated)
      let adjustedShare = studentShare;
      if (studentShare !== null) {
        try {
          const nocRequest = await NOC.findOne({
            student: _id,
            'calculatedElectricityBill.total': { $exists: true, $ne: null },
            status: { $in: ['Ready for Deactivation', 'Approved'] }
          }).sort({ 'calculatedElectricityBill.calculatedAt': -1 });

          if (nocRequest && nocRequest.calculatedElectricityBill) {
            const billMonth = new Date(bill.month + '-01');
            const billMonthEnd = new Date(billMonth.getFullYear(), billMonth.getMonth() + 1, 0);
            const nocBillStart = new Date(nocRequest.calculatedElectricityBill.billPeriodStart);
            const nocBillEnd = new Date(nocRequest.calculatedElectricityBill.billPeriodEnd);
            
            if (billMonth <= nocBillEnd && billMonthEnd >= nocBillStart) {
              // Use studentShare if available (new format), otherwise fall back to total (backward compatibility)
              const nocAmount = nocRequest.calculatedElectricityBill.studentShare || nocRequest.calculatedElectricityBill.total || 0;
              if (billMonth <= nocBillEnd) {
                adjustedShare = Math.max(0, studentShare - nocAmount);
                if (adjustedShare !== studentShare) {
                  console.log(`📊 Adjusted student bill for ${_id} in bill ${bill.month}: Subtracted NOC amount ₹${nocAmount}`);
                }
              }
            }
          }
        } catch (nocError) {
          console.error('Error checking NOC bill adjustment:', nocError);
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
        studentShare: adjustedShare,
        paymentStatus: paymentStatus,
        paymentId: paymentId,
        paidAt: paidAt,
        nocAdjustment: adjustedShare !== studentShare ? (studentShare - adjustedShare) : null
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

// Set the default electricity rate
export const setDefaultElectricityRate = (req, res) => {
  try {
    const { rate } = req.body;
    
    if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid rate. Rate must be a positive number.' 
      });
    }

    const newRate = Number(rate);
    Room.setDefaultElectricityRate(newRate);
    
    res.json({ 
      success: true, 
      message: 'Default electricity rate updated successfully',
      rate: newRate 
    });
  } catch (error) {
    console.error('Error setting default electricity rate:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update default electricity rate' 
    });
  }
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
    
    // Get student count and staff count for each room
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        gender: room.gender,
        category: room.category,
        roomNumber: room.roomNumber,
        role: 'student',
        hostelStatus: 'Active'
      });
      
      // Count staff in the room (staff can be in any category room, but must match gender)
      const staffCount = await StaffGuest.countDocuments({
        type: 'staff',
        gender: room.gender,
        roomNumber: room.roomNumber,
        isActive: true
      });
      
      const roomObject = room.toObject();
      const totalOccupancy = studentCount + staffCount;
      const availableBeds = room.bedCount - totalOccupancy;
      
      return {
        ...roomObject,
        studentCount,
        staffCount,
        totalOccupancy,
        availableBeds: Math.max(0, availableBeds),
        occupancyRate: Math.round((totalOccupancy / room.bedCount) * 100)
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