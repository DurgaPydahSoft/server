import mongoose from 'mongoose';
import Room from '../models/Room.js';
import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import StaffGuest from '../models/StaffGuest.js';
import NOC from '../models/NOC.js';
import ElectricitySettings from '../models/ElectricitySettings.js';
import ElectricityBill from '../models/ElectricityBill.js';
import GeneratorBill, { ensureGeneratorBillIndexes } from '../models/GeneratorBill.js';
import { createError } from '../utils/error.js';
import {
  countStudentsInRoomForAcademicYear,
  countRoomOccupancyForDisplay,
  countActiveStudentsInRoomForAcademicYear,
  getStudentsInRoomForAcademicYear,
  getOccupiedBedsAndLockersForAcademicYear
} from '../utils/roomOccupancyUtils.js';
import {
  applyOccupantsAndSyncDemands,
  getActiveOccupantsForRoomMonth,
  getLiveOccupantsWithAttendance,
  listFeeHeadsFromFeesDb,
  loadElectricitySettings,
  syncExistingBillFeeDemands,
  clearMonthBillsAndReverseDemands,
  MIN_ATTENDANCE_DAYS_FOR_ELECTRICITY_DEMAND
} from '../services/electricityBillingService.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const buildBillRoomMeta = (room) => ({
  room: room._id,
  hostel: room.hostel?._id || room.hostel,
  category: room.category?._id || room.category,
  roomNumber: room.roomNumber,
  meterType: room.meterType || 'single'
});

const resolveGeneratorHostelId = (req) => {
  if (req.warden?.assignedHostelId || req.admin?.role === 'warden') {
    return req.warden?.assignedHostelId?._id || req.warden?.assignedHostelId || req.admin?.assignedHostelId?._id || req.admin?.assignedHostelId || null;
  }
  return req.query.hostel || req.body.hostel || null;
};

const normalizeGeneratorBill = (generatorBill, month, hostel) => ({
  hostel: generatorBill?.hostel?._id || generatorBill?.hostel || hostel || null,
  month: generatorBill?.month || month || null,
  amount: Number(generatorBill?.amount) || 0,
  updatedAt: generatorBill?.updatedAt || null,
  createdAt: generatorBill?.createdAt || null
});

/** Upsert ElectricityBill for a room+month and sync occupant demands */
const upsertRoomElectricityBill = async (room, month, billFields) => {
  const existing = await ElectricityBill.findOne({ room: room._id, month }).lean();
  const previousStudentBills = existing?.studentBills || [];

  const occupancy = await applyOccupantsAndSyncDemands({
    room,
    month,
    total: billFields.total,
    previousStudentBills
  });

  const setPayload = {
    ...buildBillRoomMeta(room),
    ...billFields,
    studentBills: occupancy.studentBills
  };

  // Preserve payment fields on update unless explicitly overwritten
  if (existing) {
    if (setPayload.paymentStatus === undefined) setPayload.paymentStatus = existing.paymentStatus;
    if (setPayload.paymentId === undefined && existing.paymentId) setPayload.paymentId = existing.paymentId;
    if (setPayload.paidAt === undefined && existing.paidAt) setPayload.paidAt = existing.paidAt;
    if (setPayload.cashfreeOrderId === undefined && existing.cashfreeOrderId) {
      setPayload.cashfreeOrderId = existing.cashfreeOrderId;
    }
    if (setPayload.payingStudentId === undefined && existing.payingStudentId) {
      setPayload.payingStudentId = existing.payingStudentId;
    }
    if (setPayload.totalNOCAdjustment === undefined && existing.totalNOCAdjustment != null) {
      setPayload.totalNOCAdjustment = existing.totalNOCAdjustment;
    }
    if (setPayload.remainingAmount === undefined && existing.remainingAmount != null) {
      setPayload.remainingAmount = existing.remainingAmount;
    }
  }

  const bill = await ElectricityBill.findOneAndUpdate(
    { room: room._id, month },
    { $set: setPayload },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );

  return { bill, occupancy };
};

// Get all rooms with optional filtering
export const getRooms = async (req, res, next) => {
  try {
    const { hostel, category, includeLastBill, academicYear } = req.query;
    const query = {};

    if (hostel) {
      if (!isValidObjectId(hostel)) {
        return res.status(400).json({ success: false, message: 'Invalid hostel id' });
      }
      query.hostel = hostel;
    }
    if (category) {
      if (!isValidObjectId(category)) {
        return res.status(400).json({ success: false, message: 'Invalid category id' });
      }
      query.category = category;
    }

    const rooms = await Room.find(query)
      .populate('hostel', 'name code')
      .populate('category', 'name hostel')
      .sort({ roomNumber: 1 });
    
    // Get student count and staff count for each room and optionally the last bill
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      // Live (no AY): active across all years. AY: all statuses for that year.
      const studentCount = await countRoomOccupancyForDisplay(room, academicYear);
      // Available beds always based on active occupancy for the selected AY (or live active).
      const activeForVacancy = academicYear
        ? await countActiveStudentsInRoomForAcademicYear(room, academicYear)
        : studentCount;

      const staffCount = academicYear
        ? 0
        : await StaffGuest.countDocuments({
            type: 'staff',
            roomNumber: room.roomNumber,
            isActive: true
          });
      
      const roomObject = room.toObject();
      // Bills live in ElectricityBill collection — attach for API compatibility
      roomObject.electricityBills = [];

      return {
        ...roomObject,
        studentCount,
        activeStudentCount: activeForVacancy,
        staffCount,
        totalOccupancy: studentCount + staffCount,
        availableBeds: Math.max(0, (room.bedCount || 0) - activeForVacancy - staffCount),
        occupancyRate: room.bedCount
          ? Math.round(((activeForVacancy + staffCount) / room.bedCount) * 100)
          : 0,
        academicYear: academicYear || null,
        occupancyMode: academicYear ? 'ay' : 'live'
      };
    }));

    const roomsWithBills = await ElectricityBill.attachBillsToRooms(roomsWithDetails, {
      includeLastBill: includeLastBill === 'true',
      includeAllBills: true
    });

    res.json({
      success: true,
      data: {
        rooms: roomsWithBills
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get rooms for warden with assigned-hostel filtering
export const getWardenRooms = async (req, res, next) => {
  try {
    const { hostel, category, includeLastBill } = req.query;
    const query = {};
    const admin = req.admin || req.warden || req.user;
    const assignedHostelId = admin?.assignedHostelId?._id || admin?.assignedHostelId;

    // Wardens are always scoped to their assigned hostel
    if (admin?.role === 'warden' && assignedHostelId) {
      query.hostel = assignedHostelId;
    } else if (hostel) {
      if (!isValidObjectId(hostel)) {
        return res.status(400).json({ success: false, message: 'Invalid hostel id' });
      }
      query.hostel = hostel;
    }
    if (category) {
      if (!isValidObjectId(category)) {
        return res.status(400).json({ success: false, message: 'Invalid category id' });
      }
      query.category = category;
    }

    const rooms = await Room.find(query)
      .populate('hostel', 'name code')
      .populate('category', 'name hostel')
      .sort({ roomNumber: 1 });
    
    // Get student count and staff count for each room and optionally the last bill
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await User.countDocuments({
        roomNumber: room.roomNumber,
        role: 'student',
        applicationStatus: { $in: ['Active', 'Extended'] }
      });
      
      // Count staff in the room
      const staffCount = await StaffGuest.countDocuments({
        type: 'staff',
        roomNumber: room.roomNumber,
        isActive: true
      });
      
      const roomObject = room.toObject();
      roomObject.electricityBills = [];

      return {
        ...roomObject,
        studentCount,
        staffCount,
        totalOccupancy: studentCount + staffCount
      };
    }));

    const roomsWithBills = await ElectricityBill.attachBillsToRooms(roomsWithDetails, {
      includeLastBill: includeLastBill === 'true',
      includeAllBills: true
    });

    res.json({
      success: true,
      data: {
        rooms: roomsWithBills
      }
    });
  } catch (error) {
    next(error);
  }
};

// Add a new room
export const addRoom = async (req, res, next) => {
  try {
    const { hostel, category, roomNumber, bedCount, meterType } = req.body;

    if (!hostel || !category || !roomNumber) {
      throw createError(400, 'Hostel, category, and room number are required');
    }

    // Validate hostel/category existence
    const hostelDoc = await Hostel.findById(hostel);
    if (!hostelDoc) {
      throw createError(400, 'Invalid hostel');
    }
    const categoryDoc = await HostelCategory.findOne({ _id: category, hostel });
    if (!categoryDoc) {
      throw createError(400, 'Invalid category for this hostel');
    }

    // Check if room already exists within hostel+category
    const existingRoom = await Room.findOne({ hostel, category, roomNumber });
    if (existingRoom) {
      throw createError(400, 'Room number already exists in this hostel/category');
    }

    const room = new Room({
      hostel,
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
    const { hostel, category, roomNumber, isActive, bedCount, meterType } = req.body;

    const room = await Room.findById(id);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    const targetHostel = hostel || room.hostel;
    const targetCategory = category || room.category;

    // Validate hostel/category if provided
    if (hostel && !(await Hostel.exists({ _id: hostel }))) {
      throw createError(400, 'Invalid hostel');
    }
    if (category && !(await HostelCategory.exists({ _id: category, hostel: targetHostel }))) {
      throw createError(400, 'Invalid category for this hostel');
    }

    // If room number or hostels change, check for duplicates within scope
    const newRoomNumber = roomNumber || room.roomNumber;
    if (newRoomNumber !== room.roomNumber || targetHostel.toString() !== room.hostel.toString() || targetCategory.toString() !== room.category.toString()) {
      const existingRoom = await Room.findOne({ hostel: targetHostel, category: targetCategory, roomNumber: newRoomNumber, _id: { $ne: id } });
      if (existingRoom) {
        throw createError(400, 'Room number already exists in this hostel/category');
      }
    }

    // Update fields
    room.hostel = targetHostel;
    room.category = targetCategory;
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
    const { academicYear } = req.query;
    const rooms = await Room.find({})
      .populate('hostel', 'name code')
      .populate('category', 'name hostel');

    // Map stats by hostel
    const statsByHostel = new Map();

    for (const room of rooms) {
      const hostelId = room.hostel?._id?.toString() || 'unassigned';
      const hostelName = room.hostel?.name || 'Unassigned';
      const categoryId = room.category?._id?.toString() || 'uncategorized';
      const categoryName = room.category?.name || 'Uncategorized';

      // Get occupancy for display + vacancy
      const studentCount = await countRoomOccupancyForDisplay(room, academicYear);
      const activeForVacancy = academicYear
        ? await countActiveStudentsInRoomForAcademicYear(room, academicYear)
        : studentCount;
      const staffCount = academicYear
        ? 0
        : await StaffGuest.countDocuments({
            type: 'staff',
            roomNumber: room.roomNumber,
            isActive: true
          });
      const filledBeds = studentCount + staffCount;
      const vacancyFilled = activeForVacancy + staffCount;

      if (!statsByHostel.has(hostelId)) {
        statsByHostel.set(hostelId, {
          hostelId,
          hostelName,
          totalRooms: 0,
          activeRooms: 0,
          totalBeds: 0,
          filledBeds: 0,
          vacancyFilled: 0,
          categories: new Map()
        });
      }
      const hostelEntry = statsByHostel.get(hostelId);
      hostelEntry.totalRooms += 1;
      hostelEntry.activeRooms += room.isActive ? 1 : 0;
      hostelEntry.totalBeds += room.bedCount || 0;
      hostelEntry.filledBeds += filledBeds;
      hostelEntry.vacancyFilled += vacancyFilled;

      if (!hostelEntry.categories.has(categoryId)) {
        hostelEntry.categories.set(categoryId, {
          categoryId,
          categoryName,
          totalRooms: 0,
          activeRooms: 0,
          totalBeds: 0,
          filledBeds: 0,
          vacancyFilled: 0
        });
      }
      const catEntry = hostelEntry.categories.get(categoryId);
      catEntry.totalRooms += 1;
      catEntry.activeRooms += room.isActive ? 1 : 0;
      catEntry.totalBeds += room.bedCount || 0;
      catEntry.filledBeds += filledBeds;
      catEntry.vacancyFilled += vacancyFilled;
    }

    const combinedStats = Array.from(statsByHostel.values()).map(h => ({
      hostelId: h.hostelId,
      hostelName: h.hostelName,
      totalRooms: h.totalRooms,
      activeRooms: h.activeRooms,
      totalBeds: h.totalBeds,
      filledBeds: h.filledBeds,
      availableBeds: Math.max(0, h.totalBeds - h.vacancyFilled),
      categories: Array.from(h.categories.values()).map(c => ({
        ...c,
        availableBeds: Math.max(0, c.totalBeds - c.vacancyFilled)
      }))
    }));

    const overallStats = combinedStats.reduce(
      (acc, h) => {
        acc.totalRooms += h.totalRooms;
        acc.activeRooms += h.activeRooms;
        acc.totalBeds += h.totalBeds;
        acc.filledBeds += h.filledBeds;
        acc.availableBeds += h.availableBeds;
        return acc;
      },
      { totalRooms: 0, activeRooms: 0, totalBeds: 0, filledBeds: 0, availableBeds: 0 }
    );

    res.json({
      success: true,
      data: {
        overall: overallStats,
        byHostel: combinedStats,
        academicYear: academicYear || null,
        occupancyMode: academicYear ? 'ay' : 'live'
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
    const { academicYear } = req.query;

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    const students = await getStudentsInRoomForAcademicYear(room, academicYear);

    const StaffGuestModel = (await import('../models/StaffGuest.js')).default;
    const staff = academicYear
      ? []
      : await StaffGuestModel.find({
          type: 'staff',
          roomNumber: room.roomNumber,
          isActive: true
        })
          .select('name type profession phoneNumber email department roomNumber bedNumber stayType selectedMonth checkinDate checkoutDate')
          .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        students,
        staff,
        academicYear: academicYear || null
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
    let billData;

    const settings = await ElectricitySettings.getOrCreate();
    let billRate = Number(settings.defaultRate) || Room.defaultElectricityRate || 5;
    if (rate !== undefined && rate !== null && rate !== '') {
      const parsedRate = Number(rate);
      if (!isNaN(parsedRate)) {
        billRate = parsedRate;
      }
    }

    if (isDualMeter) {
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
      const consumption = meter1Consumption + meter2Consumption;
      const total = consumption * billRate;

      billData = {
        month,
        meter1StartUnits,
        meter1EndUnits,
        meter1Consumption,
        meter2StartUnits,
        meter2EndUnits,
        meter2Consumption,
        // Clear single-meter fields on dual bills
        startUnits: undefined,
        endUnits: undefined,
        consumption,
        rate: billRate,
        total
      };
    } else {
      if (typeof startUnits !== 'number' || typeof endUnits !== 'number') {
        return res.status(400).json({ success: false, message: 'Month, startUnits, and endUnits are required' });
      }

      if (endUnits < startUnits) {
        return res.status(400).json({ success: false, message: 'Ending units must be greater than or equal to starting units' });
      }

      const consumption = endUnits - startUnits;
      const total = consumption * billRate;

      billData = {
        month,
        startUnits,
        endUnits,
        consumption,
        rate: billRate,
        total
      };
    }

    const { bill, occupancy } = await upsertRoomElectricityBill(room, month, billData);
    const allBills = await ElectricityBill.find({ room: room._id }).sort({ month: -1 });

    res.json({
      success: true,
      data: allBills,
      bill,
      occupancy: {
        occupantCount: occupancy.occupantCount,
        eligibleCount: occupancy.eligibleCount,
        sharePerStudent: occupancy.sharePerStudent,
        academicYear: occupancy.academicYear,
        feeHeadConfigured: occupancy.feeHeadConfigured,
        demandsSynced: occupancy.demandResults?.filter((d) => d.ok).length || 0
      }
    });
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

    const settings = await ElectricitySettings.getOrCreate();
    const defaultRate = Number(settings.defaultRate) || Room.defaultElectricityRate || 5;
    let processed = 0;
    let demandsSynced = 0;

    for (const billData of bills) {
      const { 
        roomId, 
        startUnits, 
        endUnits, 
        rate,
        meter1StartUnits,
        meter1EndUnits,
        meter2StartUnits,
        meter2EndUnits
      } = billData;

      if (!roomId) continue;

      const room = await Room.findById(roomId);
      if (!room) {
        console.warn(`Room ${roomId} not found, skipping`);
        continue;
      }

      const isDualMeter = room.meterType === 'dual';
      let newBillPayload;
      const billRate =
        rate !== undefined && rate !== null && !isNaN(Number(rate))
          ? Number(rate)
          : defaultRate;

      if (isDualMeter) {
        if (
          meter1StartUnits === undefined ||
          meter1EndUnits === undefined ||
          meter2StartUnits === undefined ||
          meter2EndUnits === undefined
        ) {
          continue;
        }

        const m1Start = Number(meter1StartUnits);
        const m1End = Number(meter1EndUnits);
        const m2Start = Number(meter2StartUnits);
        const m2End = Number(meter2EndUnits);

        if (
          isNaN(m1Start) ||
          isNaN(m1End) ||
          isNaN(m2Start) ||
          isNaN(m2End) ||
          m1End < m1Start ||
          m2End < m2Start
        ) {
          console.warn(`Skipping invalid dual meter bill data for room ${roomId}`);
          continue;
        }

        const meter1Consumption = m1End - m1Start;
        const meter2Consumption = m2End - m2Start;
        const consumption = meter1Consumption + meter2Consumption;
        const total = consumption * billRate;

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
          total
        };
      } else {
        if (startUnits === undefined || endUnits === undefined) continue;

        const start = Number(startUnits);
        const end = Number(endUnits);

        if (isNaN(start) || isNaN(end) || end < start) {
          console.warn(`Skipping invalid bill data for room ${roomId}: start=${start}, end=${end}`);
          continue;
        }

        const consumption = end - start;
        const total = consumption * billRate;

        newBillPayload = {
          month,
          startUnits: start,
          endUnits: end,
          consumption,
          rate: billRate,
          total
        };
      }

      const { occupancy } = await upsertRoomElectricityBill(room, month, newBillPayload);
      demandsSynced += occupancy.demandResults?.filter((d) => d.ok).length || 0;
      processed += 1;
    }

    res.status(200).json({
      success: true,
      message: `Processed ${processed} bills successfully.`,
      demandsSynced
    });
  } catch (error) {
    next(error);
  }
};

// Get electricity bills for a room
export const getElectricityBills = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const room = await Room.findById(roomId).select('_id');
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    const bills = await ElectricityBill.find({ room: roomId }).sort({ month: -1 });
    res.json({ success: true, data: bills });
  } catch (error) {
    next(error);
  }
};

// Remove all electricity bills for a given month - admin only. Respects optional hostel/category filters.
export const clearElectricityBillsForMonth = async (req, res, next) => {
  try {
    const { month, hostel, category } = req.body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'A valid month in YYYY-MM format is required.'
      });
    }

    const hostelId = hostel && isValidObjectId(hostel) ? hostel : null;
    const categoryId = category && isValidObjectId(category) ? category : null;

    const result = await clearMonthBillsAndReverseDemands({
      month,
      hostel: hostelId,
      category: categoryId
    });

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: result.message,
        reason: result.reason
      });
    }

    const scope = hostelId || categoryId ? 'filtered rooms' : 'all rooms';
    res.json({
      success: true,
      message:
        result.message ||
        `Deleted electricity bills for ${month} from ${scope} and reversed student fee demands.`,
      modifiedCount: result.deletedBills,
      deletedBills: result.deletedBills,
      demandsReversed: result.demandsReversed,
      demandsDeleted: result.demandsDeleted,
      demandsFailed: result.demandsFailed,
      demandsSkipped: result.demandsSkipped,
      feeHeadConfigured: result.feeHeadConfigured,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// Get electricity bills for a student's room
export const getStudentRoomBills = async (req, res, next) => {
  try {
    const { _id, room: roomId, roomNumber } = req.user;

    // Prefer the new room reference; fall back to legacy roomNumber if still present
    const roomQuery = roomId ? { _id: roomId } : roomNumber ? { roomNumber } : null;
    if (!roomQuery) {
      return res.status(404).json({
        success: false,
        message: 'Room not found for this student'
      });
    }

    const room = await Room.findOne(roomQuery);
    if (!room) {
      return res.status(404).json({ 
        success: false, 
        message: 'Room not found' 
      });
    }

    // Bills live in ElectricityBill collection
    const sortedBills = await ElectricityBill.find({ room: room._id }).sort({ month: -1 }).lean();

    // For legacy bills without studentBills: occupants from HostelRequests for that month
    const occupantCountByMonth = new Map();

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
        // Old bill without studentBills - equal share across HostelRequest occupants for that month
        let studentsInRoom = occupantCountByMonth.get(bill.month);
        if (studentsInRoom === undefined) {
          const occupants = await getActiveOccupantsForRoomMonth(room, bill.month);
          studentsInRoom = occupants.length;
          occupantCountByMonth.set(bill.month, studentsInRoom);
        }
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

// Get the current electricity settings (rate + fee head)
export const getDefaultElectricityRate = async (req, res) => {
  try {
    const settings = await loadElectricitySettings();
    res.json({
      success: true,
      rate: settings.defaultRate,
      feeHeadId: settings.feeHeadId || null,
      feeHeadCode: settings.feeHeadCode || null,
      feeHeadName: settings.feeHeadName || null
    });
  } catch (error) {
    console.error('Error fetching electricity settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch electricity settings'
    });
  }
};

// Set default electricity rate (and optionally fee head via dedicated endpoint)
export const setDefaultElectricityRate = async (req, res) => {
  try {
    const { rate } = req.body;
    
    if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid rate. Rate must be a positive number.' 
      });
    }

    const newRate = Number(rate);
    const settings = await ElectricitySettings.getOrCreate();
    settings.defaultRate = newRate;
    settings.updatedBy = req.admin?._id || req.user?._id || null;
    await settings.save();
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

/** GET electricity settings (rate + mapped fee head) */
export const getElectricitySettings = async (req, res) => {
  try {
    const settings = await loadElectricitySettings();
    res.json({
      success: true,
      data: {
        defaultRate: settings.defaultRate,
        feeHeadId: settings.feeHeadId || null,
        feeHeadCode: settings.feeHeadCode || null,
        feeHeadName: settings.feeHeadName || null
      }
    });
  } catch (error) {
    console.error('Error fetching electricity settings:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch electricity settings' });
  }
};

export const getGeneratorBillForMonth = async (req, res) => {
  try {
    await ensureGeneratorBillIndexes();
    const month = String(req.query.month || '').trim();
    const hostel = resolveGeneratorHostelId(req);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Query month (YYYY-MM) is required.'
      });
    }
    if (!hostel || !isValidObjectId(hostel)) {
      return res.status(400).json({
        success: false,
        message: 'A valid hostel id is required.'
      });
    }

    const generatorBill = await GeneratorBill.findOne({ month, hostel }).lean();
    res.json({
      success: true,
      data: normalizeGeneratorBill(generatorBill, month, hostel)
    });
  } catch (error) {
    console.error('Error fetching generator bill:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch generator bill' });
  }
};

export const saveGeneratorBillForMonth = async (req, res) => {
  try {
    await ensureGeneratorBillIndexes();
    const month = String(req.body.month || '').trim();
    const hostel = resolveGeneratorHostelId(req);
    const parsedAmount = Number(req.body.amount);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Month must be in YYYY-MM format.'
      });
    }
    if (!hostel || !isValidObjectId(hostel)) {
      return res.status(400).json({
        success: false,
        message: 'A valid hostel id is required.'
      });
    }
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Generator amount must be 0 or more.'
      });
    }

    const actorId = req.admin?._id || req.warden?._id || req.user?._id || null;
    const existing = await GeneratorBill.findOne({ month, hostel });

    let generatorBill;
    if (existing) {
      existing.amount = parsedAmount;
      existing.updatedBy = actorId;
      generatorBill = await existing.save();
    } else {
      generatorBill = await GeneratorBill.create({
        hostel,
        month,
        amount: parsedAmount,
        createdBy: actorId,
        updatedBy: actorId
      });
    }

    res.json({
      success: true,
      message: 'Generator bill saved successfully.',
      data: normalizeGeneratorBill(generatorBill, month, hostel)
    });
  } catch (error) {
    console.error('Error saving generator bill:', error);
    res.status(500).json({ success: false, message: 'Failed to save generator bill' });
  }
};

/** POST save electricity settings (rate and/or fee head from Fees DB) */
export const saveElectricitySettings = async (req, res) => {
  try {
    const { defaultRate, feeHeadId, feeHeadCode, feeHeadName, clearFeeHead } = req.body;
    const settings = await ElectricitySettings.getOrCreate();

    if (defaultRate !== undefined && defaultRate !== null && defaultRate !== '') {
      const parsed = Number(defaultRate);
      if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid rate. Rate must be a positive number.'
        });
      }
      settings.defaultRate = parsed;
      Room.setDefaultElectricityRate(parsed);
    }

    if (clearFeeHead) {
      settings.feeHeadId = null;
      settings.feeHeadCode = null;
      settings.feeHeadName = null;
    } else if (feeHeadId) {
      settings.feeHeadId = String(feeHeadId);
      settings.feeHeadCode = feeHeadCode ? String(feeHeadCode) : settings.feeHeadCode;
      settings.feeHeadName = feeHeadName ? String(feeHeadName) : settings.feeHeadName;
    }

    settings.updatedBy = req.admin?._id || req.user?._id || null;
    await settings.save();

    res.json({
      success: true,
      message: 'Electricity settings saved successfully',
      data: {
        defaultRate: settings.defaultRate,
        feeHeadId: settings.feeHeadId || null,
        feeHeadCode: settings.feeHeadCode || null,
        feeHeadName: settings.feeHeadName || null
      }
    });
  } catch (error) {
    console.error('Error saving electricity settings:', error);
    res.status(500).json({ success: false, message: 'Failed to save electricity settings' });
  }
};

/** List fee heads from Fees MongoDB for Settings picker */
export const getFeeHeadsForElectricity = async (req, res) => {
  try {
    const result = await listFeeHeadsFromFeesDb();
    if (!result.ok) {
      return res.status(503).json({
        success: false,
        message:
          result.reason === 'fees_db_not_configured'
            ? 'Fees database is not configured (FEES_MONGODB_URI)'
            : 'Fees database is not connected',
        feeHeads: []
      });
    }
    res.json({ success: true, feeHeads: result.feeHeads });
  } catch (error) {
    console.error('Error listing fee heads:', error);
    res.status(500).json({ success: false, message: 'Failed to list fee heads', feeHeads: [] });
  }
};

/**
 * Sync Fees DB demands for an already-raised bill (create missing studentfees only).
 * POST /:roomId/electricity-bill/sync-demands  body: { month }
 */
export const syncElectricityBillDemands = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { month } = req.body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'A valid month in YYYY-MM format is required.'
      });
    }

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const result = await syncExistingBillFeeDemands({ room, month });
    if (!result.ok) {
      const status =
        result.reason === 'bill_not_found'
          ? 404
          : result.reason === 'fee_head_not_configured'
            ? 400
            : 503;
      return res.status(status).json({
        success: false,
        message: result.message,
        reason: result.reason
      });
    }

    res.json({
      success: true,
      message: `Synced room ${room.roomNumber}: ${result.eligibleCount} eligible, ${result.created} created, ${result.updated} updated, ${result.removed || 0} removed.`,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Live active students in a room + attendance days for a bill month.
 * GET /:roomId/electricity-occupants?month=YYYY-MM
 */
export const getElectricityRoomOccupants = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { month } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Query month (YYYY-MM) is required.'
      });
    }

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const students = await getLiveOccupantsWithAttendance(room, month);
    res.json({
      success: true,
      data: {
        roomNumber: room.roomNumber,
        month,
        minAttendanceDays: MIN_ATTENDANCE_DAYS_FOR_ELECTRICITY_DEMAND,
        students,
        eligibleCount: students.filter((s) => s.eligibleForDemand).length,
        totalLive: students.length
      }
    });
  } catch (error) {
    next(error);
  }
}; 

// Get room payment statistics
export const getRoomPaymentStats = async (req, res) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0, 7);

    const prevMonthDate = new Date();
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const previousMonth = prevMonthDate.toISOString().slice(0, 7);

    const groupByStatus = async (targetMonth) =>
      ElectricityBill.aggregate([
        { $match: { month: targetMonth } },
        {
          $group: {
            _id: {
              roomNumber: '$roomNumber'
            },
            paymentStatus: { $first: '$paymentStatus' },
            billAmount: { $first: '$total' },
            billMonth: { $first: '$month' }
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

    const currentMonthStats = await groupByStatus(currentMonth);
    const previousMonthStats = await groupByStatus(previousMonth);

    const paymentSummary = await ElectricityBill.aggregate([
      { $match: { month: { $in: [currentMonth, previousMonth] } } },
      {
        $group: {
          _id: {
            month: '$month',
            status: '$paymentStatus'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$total' }
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

    const payments = await ElectricityBill.aggregate([
      { $match: { month: currentMonth } },
      {
        $group: {
          _id: {
            roomNumber: '$roomNumber'
          },
          paymentStatus: { $first: '$paymentStatus' },
          billAmount: { $first: '$total' },
          billMonth: { $first: '$month' },
          paidAt: { $first: '$paidAt' }
        }
      },
      { $sort: { '_id.roomNumber': 1 } }
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

    const payments = await ElectricityBill.aggregate([
      { $match: { month: previousMonth } },
      {
        $group: {
          _id: {
            roomNumber: '$roomNumber'
          },
          paymentStatus: { $first: '$paymentStatus' },
          billAmount: { $first: '$total' },
          billMonth: { $first: '$month' },
          paidAt: { $first: '$paidAt' }
        }
      },
      { $sort: { '_id.roomNumber': 1 } }
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
// Get categories by hostel
export const getCategories = async (req, res, next) => {
  try {
    const { hostel } = req.query;
    if (!hostel) {
      return res.status(400).json({ success: false, message: 'Hostel is required' });
    }
    const categories = await HostelCategory.find({ hostel, isActive: true }).sort({ name: 1 });
    
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};

export const getRoomsWithBedAvailability = async (req, res, next) => {
  try {
    const { hostel, category, academicYear } = req.query;
    const query = {};

    const admin = req.admin || req.warden || req.user;
    const assignedHostelId = admin?.assignedHostelId?._id || admin?.assignedHostelId;

    // Wardens are always scoped to their assigned hostel
    if (admin?.role === 'warden' && assignedHostelId) {
      query.hostel = assignedHostelId;
    } else if (hostel) {
      if (!isValidObjectId(hostel)) {
        return res.status(400).json({ success: false, message: 'Invalid hostel id' });
      }
      query.hostel = hostel;
    }
    if (category) {
      if (!isValidObjectId(category)) {
        return res.status(400).json({ success: false, message: 'Invalid category id' });
      }
      query.category = category;
    }

    const rooms = await Room.find(query)
      .populate('hostel', 'name code')
      .populate('category', 'name hostel')
      .sort({ roomNumber: 1 });
    
    // Get student count and staff count for each room
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const studentCount = await countStudentsInRoomForAcademicYear(room, academicYear);

      const staffCount = await StaffGuest.countDocuments({
        type: 'staff',
        roomNumber: room.roomNumber,
        isActive: true
      });

      const roomObject = room.toObject();
      const totalOccupancy = studentCount + staffCount;
      const availableBeds = (room.bedCount || 0) - totalOccupancy;

      return {
        ...roomObject,
        studentCount,
        staffCount,
        totalOccupancy,
        availableBeds: Math.max(0, availableBeds),
        occupancyRate: room.bedCount
          ? Math.round((totalOccupancy / room.bedCount) * 100)
          : 0,
        academicYear: academicYear || null
      };
    }));

    res.json({
      success: true,
      data: {
        rooms: roomsWithDetails,
        academicYear: academicYear || null
      }
    });
  } catch (error) {
    next(error);
  }
};