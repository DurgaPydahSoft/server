import StaffGuest from '../models/StaffGuest.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import { createError } from '../utils/error.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import axios from 'axios';

// Global settings for daily rates (in-memory for now, can be moved to database later)
let dailyRateSettings = {
  staffDailyRate: 100, // Default daily rate for staff
  lastUpdated: new Date(),
  updatedBy: null
};

// Helper function to fetch image and convert to base64
const fetchImageAsBase64 = async (imageUrl) => {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const buffer = Buffer.from(response.data, 'binary');
    const base64 = buffer.toString('base64');
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error fetching image as base64:', error);
    return null;
  }
};

// Helper function to check room availability
const checkRoomAvailability = async (roomNumber, gender, category) => {
  const room = await Room.findOne({ roomNumber, gender, category });
  if (!room) {
    throw createError(404, 'Room not found');
  }

  // Count students in the room
  const studentCount = await User.countDocuments({
    gender,
    category,
    roomNumber,
    role: 'student',
    hostelStatus: 'Active'
  });

  // Count staff in the room
  const staffCount = await StaffGuest.countDocuments({
    type: 'staff',
    gender,
    roomNumber,
    isActive: true
  });

  const totalOccupancy = studentCount + staffCount;
  const availableBeds = room.bedCount - totalOccupancy;

  return {
    room,
    studentCount,
    staffCount,
    totalOccupancy,
    availableBeds,
    isAvailable: availableBeds > 0
  };
};

// Add a new staff/guest
export const addStaffGuest = async (req, res, next) => {
  try {
    const {
      name,
      type,
      gender,
      profession,
      phoneNumber,
      email,
      department,
      purpose,
      checkinDate,
      checkoutDate,
      stayType,
      selectedMonth,
      roomNumber,
      bedNumber,
      dailyRate
    } = req.body;

    // Validate required fields
    if (!name || !type || !gender || !profession || !phoneNumber) {
      throw createError(400, 'Name, type, gender, profession, and phone number are required');
    }

    // Validate type
    if (!['staff', 'guest', 'student'].includes(type)) {
      throw createError(400, 'Type must be staff, guest, or student');
    }

    // Validate gender
    if (!['Male', 'Female', 'Other'].includes(gender)) {
      throw createError(400, 'Gender must be Male, Female, or Other');
    }

    // For staff type, validate stayType
    if (type === 'staff') {
      if (!stayType || !['daily', 'monthly'].includes(stayType)) {
        throw createError(400, 'Stay type must be either "daily" or "monthly" for staff');
      }

      // If monthly basis, validate selectedMonth
      if (stayType === 'monthly') {
        if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
          throw createError(400, 'Valid month (YYYY-MM format) is required for monthly basis');
        }
      }

      // If daily basis, validate checkinDate
      if (stayType === 'daily' && !checkinDate) {
        throw createError(400, 'Check-in date is required for daily basis');
      }
    }

    // Check for duplicates - check phone number and name combination
    const existingStaffGuest = await StaffGuest.findOne({ 
      $or: [
        { phoneNumber, isActive: true },
        { 
          name: name.trim(),
          phoneNumber,
          type,
          isActive: true 
        }
      ]
    });
    if (existingStaffGuest) {
      throw createError(400, `A ${type} with the same phone number or name already exists. Please check existing records.`);
    }

    // Handle room allocation for staff
    let roomAllocation = null;
    if (type === 'staff' && roomNumber) {
      // For staff, we need category - but staff might not have category
      // We'll need to find rooms that match gender only, or add category to staff
      // For now, let's check if room exists and matches gender
      const room = await Room.findOne({ roomNumber, gender });
      if (!room) {
        throw createError(404, `Room ${roomNumber} not found for ${gender} gender`);
      }

      // Check room availability (including staff occupancy)
      roomAllocation = await checkRoomAvailability(roomNumber, gender, room.category);
      if (!roomAllocation.isAvailable) {
        throw createError(400, `Room ${roomNumber} is fully occupied. Available beds: ${roomAllocation.availableBeds}`);
      }

      // Check if bed number is already taken in this room
      if (bedNumber) {
        const bedOccupied = await StaffGuest.findOne({
          type: 'staff',
          roomNumber,
          bedNumber,
          isActive: true,
          _id: { $ne: req.body._id }
        });
        if (bedOccupied) {
          throw createError(400, `Bed ${bedNumber} in room ${roomNumber} is already occupied`);
        }
      }
    }

    // Handle photo upload
    let photoUrl = null;
    if (req.file) {
      photoUrl = await uploadToS3(req.file, 'staff-guest-photos');
    }

    // Calculate charges for staff and students only
    let calculatedCharges = 0;
    if (type === 'staff') {
      if (stayType === 'monthly' && selectedMonth) {
        // For monthly basis, calculate charges for the entire month
        const tempStaffGuest = new StaffGuest({
          type: 'staff',
          stayType: 'monthly',
          selectedMonth,
          dailyRate: dailyRate ? parseFloat(dailyRate) : null
        });
        calculatedCharges = tempStaffGuest.calculateCharges(dailyRateSettings.staffDailyRate);
      } else if (stayType === 'daily' && checkinDate) {
        // For daily basis, use existing logic
        const tempStaffGuest = new StaffGuest({
          type: 'staff',
          stayType: 'daily',
          checkinDate: new Date(checkinDate),
          checkoutDate: checkoutDate ? new Date(checkoutDate) : null,
          dailyRate: dailyRate ? parseFloat(dailyRate) : null
        });
        calculatedCharges = tempStaffGuest.calculateCharges(dailyRateSettings.staffDailyRate);
      }
    } else if (type === 'student' && checkinDate) {
      const tempStaffGuest = new StaffGuest({
        type: 'student',
        checkinDate: new Date(checkinDate),
        checkoutDate: checkoutDate ? new Date(checkoutDate) : null,
        dailyRate: dailyRate ? parseFloat(dailyRate) : null
      });
      calculatedCharges = tempStaffGuest.calculateCharges(dailyRateSettings.staffDailyRate);
    }

    // Create new staff/guest
    const staffGuest = new StaffGuest({
      name: name.trim(),
      type,
      gender,
      profession: profession.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email ? email.trim() : undefined,
      department: ['staff', 'student'].includes(type) ? (department ? department.trim() : undefined) : undefined,
      purpose: purpose ? purpose.trim() : '',
      checkinDate: stayType === 'daily' && checkinDate ? new Date(checkinDate) : null,
      checkoutDate: stayType === 'daily' && checkoutDate ? new Date(checkoutDate) : null,
      stayType: type === 'staff' ? stayType : 'daily',
      selectedMonth: type === 'staff' && stayType === 'monthly' ? selectedMonth : null,
      roomNumber: type === 'staff' && roomNumber ? roomNumber.trim() : null,
      bedNumber: type === 'staff' && bedNumber ? bedNumber.trim() : null,
      dailyRate: dailyRate ? parseFloat(dailyRate) : null,
      calculatedCharges,
      photo: photoUrl,
      createdBy: req.admin._id
    });

    const savedStaffGuest = await staffGuest.save();

    res.status(201).json({
      success: true,
      data: savedStaffGuest,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} added successfully`
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to automatically expire monthly staff members
const expireMonthlyStaff = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all active monthly staff members whose month has expired
    const expiredStaff = await StaffGuest.find({
      type: 'staff',
      stayType: 'monthly',
      isActive: true,
      selectedMonth: { $exists: true, $ne: null }
    });

    const expiredIds = [];
    for (const staff of expiredStaff) {
      if (staff.isValidityExpired()) {
        // Clear room allocation and mark as inactive
        staff.roomNumber = null;
        staff.bedNumber = null;
        staff.isActive = false;
        await staff.save();
        expiredIds.push(staff._id);
      }
    }

    if (expiredIds.length > 0) {
      console.log(`Automatically expired ${expiredIds.length} monthly staff members`);
    }

    return expiredIds;
  } catch (error) {
    console.error('Error expiring monthly staff:', error);
    return [];
  }
};

// Get all staff/guests with pagination and filters
export const getStaffGuests = async (req, res, next) => {
  try {
    console.log('=== GET STAFF/GUESTS REQUEST ===');
    console.log('Query params:', req.query);
    console.log('User:', req.user);
    
    // Automatically expire monthly staff members before fetching
    await expireMonthlyStaff();
    
    const { 
      page = 1, 
      limit = 10, 
      type, 
      gender, 
      department, 
      search, 
      isActive 
    } = req.query;

    // Handle isActive filter - default to true if not specified
    // Query params come as strings, so we need to check both 'true' string and true boolean
    const isActiveFilter = isActive === undefined || isActive === 'true' || isActive === true;
    const query = { isActive: isActiveFilter };
    
    console.log('Query filter - isActive param:', isActive, '→ isActiveFilter:', isActiveFilter);

    // Add filters if provided (skip empty strings)
    if (type && type.trim() !== '') query.type = type;
    if (gender && gender.trim() !== '') query.gender = gender;
    if (department && department.trim() !== '') query.department = department;

    // Add search functionality
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { profession: searchRegex },
        { phoneNumber: searchRegex },
        { email: searchRegex }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const staffGuests = await StaffGuest.find(query)
      .populate('createdBy', 'username role')
      .populate('lastModifiedBy', 'username role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    console.log('Query result count:', staffGuests.length);
    console.log('Final query used:', JSON.stringify(query, null, 2));
    if (staffGuests.length > 0) {
      console.log('Sample staff guest:', {
        name: staffGuests[0].name,
        type: staffGuests[0].type,
        isActive: staffGuests[0].isActive,
        selectedMonth: staffGuests[0].selectedMonth,
        phoneNumber: staffGuests[0].phoneNumber
      });
    } else {
      console.log('No results found with query:', query);
      // Debug: Check if records exist at all
      const totalCount = await StaffGuest.countDocuments({});
      const activeCount = await StaffGuest.countDocuments({ isActive: true });
      const monthlyStaffCount = await StaffGuest.countDocuments({ 
        type: 'staff', 
        stayType: 'monthly', 
        isActive: true 
      });
      console.log('Debug counts - Total:', totalCount, 'Active:', activeCount, 'Monthly Staff Active:', monthlyStaffCount);
    }

    // Recalculate charges for staff and students to ensure they're up to date
    // This ensures charges are always accurate, especially after fixing the calculation method
    const staffGuestsWithRecalculatedCharges = staffGuests.map((sg) => {
      // sg is already a StaffGuest document instance, so we can call methods directly
      if (['staff', 'student'].includes(sg.type)) {
        // Recalculate charges based on current settings
        const recalculatedCharges = sg.calculateCharges(dailyRateSettings.staffDailyRate);
        // Update the calculatedCharges in the document (this modifies the instance)
        sg.calculatedCharges = recalculatedCharges;
      } else if (sg.type === 'guest') {
        // Guests have no charges
        sg.calculatedCharges = 0;
      }
      return sg;
    });

    const total = await StaffGuest.countDocuments(query);

    console.log('=== STAFF/GUESTS RESPONSE ===');
    console.log('Found staff/guests:', staffGuestsWithRecalculatedCharges.length);
    console.log('Total count:', total);
    console.log('Query used:', query);

    res.json({
      success: true,
      data: {
        staffGuests: staffGuestsWithRecalculatedCharges,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          totalStaffGuests: total
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get staff/guest by ID
export const getStaffGuestById = async (req, res, next) => {
  try {
    const staffGuest = await StaffGuest.findById(req.params.id)
      .populate('createdBy', 'username role')
      .populate('lastModifiedBy', 'username role');

    if (!staffGuest) {
      throw createError(404, 'Staff/Guest not found');
    }

    res.json({
      success: true,
      data: staffGuest
    });
  } catch (error) {
    next(error);
  }
};

// Update staff/guest
export const updateStaffGuest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      type,
      gender,
      profession,
      phoneNumber,
      email,
      department,
      purpose,
      checkinDate,
      checkoutDate,
      stayType,
      selectedMonth,
      roomNumber,
      bedNumber,
      dailyRate
    } = req.body;

    const staffGuest = await StaffGuest.findById(id);
    if (!staffGuest) {
      throw createError(404, 'Staff/Guest not found');
    }

    // Validate type if provided
    if (type && !['staff', 'guest', 'student'].includes(type)) {
      throw createError(400, 'Type must be staff, guest, or student');
    }

    // Validate gender if provided
    if (gender && !['Male', 'Female', 'Other'].includes(gender)) {
      throw createError(400, 'Gender must be Male, Female, or Other');
    }

    // For staff type, validate stayType
    const currentType = type || staffGuest.type;
    if (currentType === 'staff') {
      const currentStayType = stayType !== undefined ? stayType : staffGuest.stayType;
      if (currentStayType && !['daily', 'monthly'].includes(currentStayType)) {
        throw createError(400, 'Stay type must be either "daily" or "monthly" for staff');
      }

      // If monthly basis, validate selectedMonth
      if (currentStayType === 'monthly') {
        const month = selectedMonth !== undefined ? selectedMonth : staffGuest.selectedMonth;
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
          throw createError(400, 'Valid month (YYYY-MM format) is required for monthly basis');
        }
      }

      // If daily basis, validate checkinDate
      if (currentStayType === 'daily' && !checkinDate && !staffGuest.checkinDate) {
        throw createError(400, 'Check-in date is required for daily basis');
      }
    }

    // Check for duplicates (excluding current record)
    if (phoneNumber && phoneNumber !== staffGuest.phoneNumber) {
      const existingStaffGuest = await StaffGuest.findOne({ 
        $or: [
          { phoneNumber, isActive: true, _id: { $ne: id } },
          { 
            name: (name || staffGuest.name).trim(),
            phoneNumber,
            type: type || staffGuest.type,
            isActive: true,
            _id: { $ne: id }
          }
        ]
      });
      if (existingStaffGuest) {
        throw createError(400, `A ${type || staffGuest.type} with the same phone number or name already exists. Please check existing records.`);
      }
    }
    
    // Also check if name changed and creates duplicate
    if (name && name.trim() !== staffGuest.name) {
      const existingByName = await StaffGuest.findOne({
        name: name.trim(),
        phoneNumber: phoneNumber || staffGuest.phoneNumber,
        type: type || staffGuest.type,
        isActive: true,
        _id: { $ne: id }
      });
      if (existingByName) {
        throw createError(400, 'A staff/guest with the same name and phone number already exists');
      }
    }

    // Handle room allocation for staff
    const currentGender = gender || staffGuest.gender;
    if (currentType === 'staff' && roomNumber !== undefined) {
      if (roomNumber) {
        // Find room to get category
        const room = await Room.findOne({ roomNumber, gender: currentGender });
        if (!room) {
          throw createError(404, `Room ${roomNumber} not found for ${currentGender} gender`);
        }

        // Check room availability (excluding current staff member)
        const roomAllocation = await checkRoomAvailability(roomNumber, currentGender, room.category);
        
        // If changing room, check if new room has availability
        if (staffGuest.roomNumber !== roomNumber) {
          if (!roomAllocation.isAvailable) {
            throw createError(400, `Room ${roomNumber} is fully occupied. Available beds: ${roomAllocation.availableBeds}`);
          }
        } else {
          // Same room, check if still available (might have been at capacity)
          if (roomAllocation.totalOccupancy >= room.bedCount) {
            throw createError(400, `Room ${roomNumber} is fully occupied`);
          }
        }

        // Check if bed number is already taken (excluding current staff)
        if (bedNumber) {
          const bedOccupied = await StaffGuest.findOne({
            type: 'staff',
            roomNumber,
            bedNumber,
            isActive: true,
            _id: { $ne: id }
          });
          if (bedOccupied) {
            throw createError(400, `Bed ${bedNumber} in room ${roomNumber} is already occupied`);
          }
        }
      }
    }

    // Handle photo upload
    if (req.file) {
      // Delete old photo if exists
      if (staffGuest.photo) {
        try {
          await deleteFromS3(staffGuest.photo);
        } catch (error) {
          console.error('Error deleting old photo:', error);
        }
      }
      // Upload new photo
      staffGuest.photo = await uploadToS3(req.file, 'staff-guest-photos');
    }

    // Update fields
    if (name) staffGuest.name = name.trim();
    if (type) staffGuest.type = type;
    if (gender) staffGuest.gender = gender;
    if (profession) staffGuest.profession = profession.trim();
    if (phoneNumber) staffGuest.phoneNumber = phoneNumber.trim();
    if (email !== undefined) staffGuest.email = email ? email.trim() : undefined;
    if (department !== undefined) {
      staffGuest.department = ['staff', 'student'].includes(currentType) ? 
        (department ? department.trim() : undefined) : undefined;
    }
    if (purpose !== undefined) staffGuest.purpose = purpose ? purpose.trim() : '';
    
    // Update stay-related fields
    if (currentType === 'staff') {
      if (stayType !== undefined) staffGuest.stayType = stayType;
      if (stayType === 'monthly' && selectedMonth !== undefined) {
        staffGuest.selectedMonth = selectedMonth;
        staffGuest.checkinDate = null;
        staffGuest.checkoutDate = null;
      } else if (stayType === 'daily') {
        if (checkinDate !== undefined) staffGuest.checkinDate = checkinDate ? new Date(checkinDate) : null;
        if (checkoutDate !== undefined) staffGuest.checkoutDate = checkoutDate ? new Date(checkoutDate) : null;
        staffGuest.selectedMonth = null;
      }
      if (roomNumber !== undefined) staffGuest.roomNumber = roomNumber ? roomNumber.trim() : null;
      if (bedNumber !== undefined) staffGuest.bedNumber = bedNumber ? bedNumber.trim() : null;
    } else {
      if (checkinDate !== undefined) staffGuest.checkinDate = checkinDate ? new Date(checkinDate) : null;
      if (checkoutDate !== undefined) staffGuest.checkoutDate = checkoutDate ? new Date(checkoutDate) : null;
    }
    
    if (dailyRate !== undefined) staffGuest.dailyRate = dailyRate ? parseFloat(dailyRate) : null;
    
    // Recalculate charges for staff and students
    if (currentType === 'staff') {
      if (staffGuest.stayType === 'monthly' && staffGuest.selectedMonth) {
        staffGuest.calculatedCharges = staffGuest.calculateCharges(dailyRateSettings.staffDailyRate);
      } else if (staffGuest.stayType === 'daily' && staffGuest.checkinDate) {
        staffGuest.calculatedCharges = staffGuest.calculateCharges(dailyRateSettings.staffDailyRate);
      }
    } else if (currentType === 'student' && staffGuest.checkinDate) {
      staffGuest.calculatedCharges = staffGuest.calculateCharges(dailyRateSettings.staffDailyRate);
    } else if (currentType === 'guest') {
      staffGuest.calculatedCharges = 0;
    }
    
    staffGuest.lastModifiedBy = req.admin._id;

    const updatedStaffGuest = await staffGuest.save();

    res.json({
      success: true,
      data: updatedStaffGuest,
      message: 'Staff/Guest updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Delete staff/guest (soft delete)
export const deleteStaffGuest = async (req, res, next) => {
  try {
    const { id } = req.params;

    const staffGuest = await StaffGuest.findById(id);
    if (!staffGuest) {
      throw createError(404, 'Staff/Guest not found');
    }

    // Soft delete by setting isActive to false
    staffGuest.isActive = false;
    staffGuest.lastModifiedBy = req.admin._id;
    await staffGuest.save();

    res.json({
      success: true,
      message: 'Staff/Guest deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Check in/out staff/guest
export const checkInOutStaffGuest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'checkin' or 'checkout'

    if (!['checkin', 'checkout'].includes(action)) {
      throw createError(400, 'Action must be either "checkin" or "checkout"');
    }

    const staffGuest = await StaffGuest.findById(id);
    if (!staffGuest) {
      throw createError(404, 'Staff/Guest not found');
    }

    if (action === 'checkin') {
      if (staffGuest.isCheckedIn()) {
        throw createError(400, 'Staff/Guest is already checked in');
      }
      staffGuest.checkInTime = new Date();
      staffGuest.checkOutTime = null;
    } else {
      if (!staffGuest.isCheckedIn()) {
        throw createError(400, 'Staff/Guest is not currently checked in');
      }
      staffGuest.checkOutTime = new Date();
    }

    staffGuest.lastModifiedBy = req.admin._id;
    await staffGuest.save();

    res.json({
      success: true,
      data: staffGuest,
      message: `Staff/Guest ${action === 'checkin' ? 'checked in' : 'checked out'} successfully`
    });
  } catch (error) {
    next(error);
  }
};

// Renew monthly staff member
export const renewMonthlyStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { selectedMonth, roomNumber, bedNumber } = req.body;

    if (!selectedMonth) {
      throw createError(400, 'Selected month is required for renewal');
    }

    // Validate month format (YYYY-MM)
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(selectedMonth)) {
      throw createError(400, 'Invalid month format. Use YYYY-MM format (e.g., 2024-03)');
    }

    const staffGuest = await StaffGuest.findById(id);
    if (!staffGuest) {
      throw createError(404, 'Staff/Guest not found');
    }

    if (staffGuest.type !== 'staff') {
      throw createError(400, 'Only staff members can be renewed');
    }

    if (staffGuest.stayType !== 'monthly') {
      throw createError(400, 'Only monthly staff members can be renewed');
    }

    // Check if the selected month is in the future
    const [year, month] = selectedMonth.split('-').map(Number);
    const selectedDate = new Date(year, month - 1, 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
      throw createError(400, 'Cannot renew for a past month. Please select a current or future month.');
    }

    // Handle room allocation if provided
    if (roomNumber) {
      const room = await Room.findOne({ roomNumber, gender: staffGuest.gender });
      if (!room) {
        throw createError(404, `Room ${roomNumber} not found for ${staffGuest.gender} gender`);
      }

      // Check room availability (including staff occupancy)
      const roomAllocation = await checkRoomAvailability(roomNumber, staffGuest.gender, room.category);
      if (!roomAllocation.isAvailable) {
        throw createError(400, `Room ${roomNumber} is fully occupied. Available beds: ${roomAllocation.availableBeds}`);
      }

      // Check if bed number is already taken in this room (excluding current staff)
      if (bedNumber) {
        const bedOccupied = await StaffGuest.findOne({
          type: 'staff',
          roomNumber,
          bedNumber,
          isActive: true,
          _id: { $ne: id }
        });
        if (bedOccupied) {
          throw createError(400, `Bed ${bedNumber} in room ${roomNumber} is already occupied`);
        }
      }

      staffGuest.roomNumber = roomNumber.trim();
      staffGuest.bedNumber = bedNumber ? bedNumber.trim() : null;
    }

    // Update selected month and reactivate
    staffGuest.selectedMonth = selectedMonth;
    staffGuest.isActive = true;
    staffGuest.checkInTime = new Date();
    staffGuest.checkOutTime = null;

    // Recalculate charges for the new month
    const tempStaffGuest = new StaffGuest({
      type: 'staff',
      stayType: 'monthly',
      selectedMonth,
      dailyRate: staffGuest.dailyRate
    });
    staffGuest.calculatedCharges = tempStaffGuest.calculateCharges(dailyRateSettings.staffDailyRate);

    staffGuest.lastModifiedBy = req.admin._id;
    const renewedStaffGuest = await staffGuest.save();

    res.json({
      success: true,
      data: renewedStaffGuest,
      message: 'Staff member renewed successfully for the selected month'
    });
  } catch (error) {
    next(error);
  }
};

// Get staff/guest statistics
export const getStaffGuestStats = async (req, res, next) => {
  try {
    const totalStaff = await StaffGuest.countDocuments({ type: 'staff', isActive: true });
    const totalGuests = await StaffGuest.countDocuments({ type: 'guest', isActive: true });
    const totalStudents = await StaffGuest.countDocuments({ type: 'student', isActive: true });
    const checkedInStaff = await StaffGuest.countDocuments({ 
      type: 'staff', 
      isActive: true,
      checkInTime: { $exists: true },
      checkOutTime: null
    });
    const checkedInGuests = await StaffGuest.countDocuments({ 
      type: 'guest', 
      isActive: true,
      checkInTime: { $exists: true },
      checkOutTime: null
    });
    const checkedInStudents = await StaffGuest.countDocuments({ 
      type: 'student', 
      isActive: true,
      checkInTime: { $exists: true },
      checkOutTime: null
    });

    res.json({
      success: true,
      data: {
        totalStaff,
        totalGuests,
        totalStudents,
        checkedInStaff,
        checkedInGuests,
        checkedInStudents,
        totalRegistered: totalStaff + totalGuests + totalStudents, // All registered (active records)
        totalActive: checkedInStaff + checkedInGuests + checkedInStudents, // Currently checked in only
        totalCheckedIn: checkedInStaff + checkedInGuests + checkedInStudents
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get daily rate settings
export const getDailyRateSettings = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        staffDailyRate: dailyRateSettings.staffDailyRate,
        lastUpdated: dailyRateSettings.lastUpdated,
        updatedBy: dailyRateSettings.updatedBy
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update daily rate settings
export const updateDailyRateSettings = async (req, res, next) => {
  try {
    const { staffDailyRate } = req.body;

    if (!staffDailyRate || staffDailyRate < 0) {
      throw createError(400, 'Valid daily rate is required');
    }

    dailyRateSettings.staffDailyRate = parseFloat(staffDailyRate);
    dailyRateSettings.lastUpdated = new Date();
    dailyRateSettings.updatedBy = req.admin._id;

    // Recalculate charges for all active staff
    const activeStaff = await StaffGuest.find({ 
      type: 'staff', 
      isActive: true,
      checkinDate: { $exists: true }
    });

    for (const staff of activeStaff) {
      staff.calculatedCharges = staff.calculateCharges(dailyRateSettings.staffDailyRate);
      await staff.save();
    }

    res.json({
      success: true,
      data: {
        staffDailyRate: dailyRateSettings.staffDailyRate,
        lastUpdated: dailyRateSettings.lastUpdated,
        updatedBy: dailyRateSettings.updatedBy
      },
      message: 'Daily rate updated successfully. All staff charges have been recalculated.'
    });
  } catch (error) {
    next(error);
  }
};

// Generate admit card for staff/guest
export const generateAdmitCard = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const staffGuest = await StaffGuest.findById(id)
      .populate('createdBy', 'username role')
      .populate('lastModifiedBy', 'username role');

    if (!staffGuest) {
      throw createError(404, 'Staff/Guest not found');
    }

    // Fetch the photo and convert to base64 for PDF generation
    let photoBase64 = null;
    if (staffGuest.photo) {
      photoBase64 = await fetchImageAsBase64(staffGuest.photo);
      if (!photoBase64) {
        console.warn('Failed to fetch staff/guest photo as base64, will use placeholder');
      }
    }

    // Get validity period for monthly basis staff
    let validityPeriod = null;
    let isValidityExpired = false;
    if (staffGuest.type === 'staff' && staffGuest.stayType === 'monthly' && staffGuest.selectedMonth) {
      validityPeriod = staffGuest.getValidityPeriod();
      isValidityExpired = staffGuest.isValidityExpired();
    }

    // Generate admit card data
    const admitCardData = {
      id: staffGuest._id,
      name: staffGuest.name,
      type: staffGuest.type,
      gender: staffGuest.gender,
      profession: staffGuest.profession,
      phoneNumber: staffGuest.phoneNumber,
      email: staffGuest.email,
      department: staffGuest.department,
      purpose: staffGuest.purpose,
      checkinDate: staffGuest.checkinDate,
      checkoutDate: staffGuest.checkoutDate,
      stayType: staffGuest.stayType,
      selectedMonth: staffGuest.selectedMonth,
      roomNumber: staffGuest.roomNumber,
      bedNumber: staffGuest.bedNumber,
      dailyRate: staffGuest.dailyRate,
      calculatedCharges: staffGuest.calculatedCharges,
      photo: photoBase64 || staffGuest.photo, // Use base64 if available, fallback to URL
      checkInTime: staffGuest.checkInTime,
      checkOutTime: staffGuest.checkOutTime,
      isCheckedIn: staffGuest.isCheckedIn(),
      stayDuration: staffGuest.getStayDuration(),
      dayCount: staffGuest.getDayCount(),
      validityPeriod,
      isValidityExpired,
      generatedAt: new Date(),
      generatedBy: req.admin.username
    };

    res.json({
      success: true,
      data: admitCardData,
      message: 'Admit card generated successfully'
    });
  } catch (error) {
    next(error);
  }
};
