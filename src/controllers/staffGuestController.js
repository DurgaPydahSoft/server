import StaffGuest from '../models/StaffGuest.js';
import { createError } from '../utils/error.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';

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
      department
    } = req.body;

    // Validate required fields
    if (!name || !type || !gender || !profession || !phoneNumber) {
      throw createError(400, 'Name, type, gender, profession, and phone number are required');
    }

    // Validate type
    if (!['staff', 'guest'].includes(type)) {
      throw createError(400, 'Type must be either "staff" or "guest"');
    }

    // Validate gender
    if (!['Male', 'Female', 'Other'].includes(gender)) {
      throw createError(400, 'Gender must be Male, Female, or Other');
    }

    // Check if phone number already exists
    const existingStaffGuest = await StaffGuest.findOne({ 
      phoneNumber,
      isActive: true 
    });
    if (existingStaffGuest) {
      throw createError(400, 'Phone number already exists for an active staff/guest');
    }

    // Handle photo upload
    let photoUrl = null;
    if (req.files && req.files.photo && req.files.photo[0]) {
      photoUrl = await uploadToS3(req.files.photo[0], 'staff-guest-photos');
    }

    // Create new staff/guest
    const staffGuest = new StaffGuest({
      name: name.trim(),
      type,
      gender,
      profession: profession.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email ? email.trim() : undefined,
      department: type === 'staff' ? (department ? department.trim() : undefined) : undefined,
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

// Get all staff/guests with pagination and filters
export const getStaffGuests = async (req, res, next) => {
  try {
    console.log('=== GET STAFF/GUESTS REQUEST ===');
    console.log('Query params:', req.query);
    console.log('User:', req.user);
    
    const { 
      page = 1, 
      limit = 10, 
      type, 
      gender, 
      department, 
      search, 
      isActive = true 
    } = req.query;

    const query = { isActive: isActive === 'true' };

    // Add filters if provided
    if (type) query.type = type;
    if (gender) query.gender = gender;
    if (department) query.department = department;

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

    const total = await StaffGuest.countDocuments(query);

    console.log('=== STAFF/GUESTS RESPONSE ===');
    console.log('Found staff/guests:', staffGuests.length);
    console.log('Total count:', total);
    console.log('Query used:', query);

    res.json({
      success: true,
      data: {
        staffGuests,
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
      department
    } = req.body;

    const staffGuest = await StaffGuest.findById(id);
    if (!staffGuest) {
      throw createError(404, 'Staff/Guest not found');
    }

    // Validate type if provided
    if (type && !['staff', 'guest'].includes(type)) {
      throw createError(400, 'Type must be either "staff" or "guest"');
    }

    // Validate gender if provided
    if (gender && !['Male', 'Female', 'Other'].includes(gender)) {
      throw createError(400, 'Gender must be Male, Female, or Other');
    }

    // Check if phone number already exists (excluding current record)
    if (phoneNumber && phoneNumber !== staffGuest.phoneNumber) {
      const existingStaffGuest = await StaffGuest.findOne({ 
        phoneNumber,
        isActive: true,
        _id: { $ne: id }
      });
      if (existingStaffGuest) {
        throw createError(400, 'Phone number already exists for another active staff/guest');
      }
    }

    // Handle photo upload
    if (req.files && req.files.photo && req.files.photo[0]) {
      // Delete old photo if exists
      if (staffGuest.photo) {
        try {
          await deleteFromS3(staffGuest.photo);
        } catch (error) {
          console.error('Error deleting old photo:', error);
        }
      }
      // Upload new photo
      staffGuest.photo = await uploadToS3(req.files.photo[0], 'staff-guest-photos');
    }

    // Update fields
    if (name) staffGuest.name = name.trim();
    if (type) staffGuest.type = type;
    if (gender) staffGuest.gender = gender;
    if (profession) staffGuest.profession = profession.trim();
    if (phoneNumber) staffGuest.phoneNumber = phoneNumber.trim();
    if (email !== undefined) staffGuest.email = email ? email.trim() : undefined;
    if (department !== undefined) {
      staffGuest.department = (type || staffGuest.type) === 'staff' ? 
        (department ? department.trim() : undefined) : undefined;
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

// Get staff/guest statistics
export const getStaffGuestStats = async (req, res, next) => {
  try {
    const totalStaff = await StaffGuest.countDocuments({ type: 'staff', isActive: true });
    const totalGuests = await StaffGuest.countDocuments({ type: 'guest', isActive: true });
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

    res.json({
      success: true,
      data: {
        totalStaff,
        totalGuests,
        checkedInStaff,
        checkedInGuests,
        totalActive: totalStaff + totalGuests,
        totalCheckedIn: checkedInStaff + checkedInGuests
      }
    });
  } catch (error) {
    next(error);
  }
};
