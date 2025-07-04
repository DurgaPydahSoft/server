import Complaint from '../models/Complaint.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import Member from '../models/Member.js';
import mongoose from 'mongoose';
import { createError } from '../utils/error.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import notificationService from '../utils/notificationService.js';

// Student: create complaint
export const createComplaint = async (req, res, next) => {
  try {
    const { title, description, category, subCategory, priority, roomNumber } = req.body;
    const studentId = req.user._id;

    console.log('📝 Creating complaint for student:', studentId);
    console.log('📝 Request body:', req.body);
    console.log('📝 Request file:', req.file);

    // Handle image upload if present
    let imageUrl = null;
    if (req.file) {
      try {
        console.log('📝 Uploading image to S3...');
        imageUrl = await uploadToS3(req.file, 'complaints');
        console.log('📝 Image uploaded successfully:', imageUrl);
      } catch (uploadError) {
        console.error('📝 Error uploading image:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload image',
          error: uploadError.message
        });
      }
    }

    const complaint = new Complaint({
      title,
      description,
      category,
      subCategory, 
      priority,
      roomNumber,
      student: studentId,
      imageUrl,
      status: 'pending'
    });

    await complaint.save();

    // Populate student details for notification
    await complaint.populate('student', 'name email');

    console.log('📝 Complaint created successfully:', complaint._id);

    // Send notification to all admins
    try {
      const admins = await User.find({ 
        role: { $in: ['admin', 'super_admin', 'sub_admin'] } 
      });

      if (admins.length > 0) {
        const adminIds = admins.map(admin => admin._id);
        
        // Send notification to all admins
        for (const adminId of adminIds) {
          await notificationService.sendComplaintNotification(
            adminId,
            complaint,
            complaint.student.name,
            studentId
          );
        }

        console.log('🔔 Complaint notification sent to', adminIds.length, 'admins');
      }
    } catch (notificationError) {
      console.error('🔔 Error sending complaint notification:', notificationError);
      // Don't fail the complaint creation if notification fails
    }

    res.status(201).json({
      success: true,
      message: 'Complaint submitted successfully',
      data: complaint
    });
  } catch (error) {
    console.error('📝 Error creating complaint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit complaint',
      error: error.message
    });
  }
};

// Student: list own complaints
export const listMyComplaints = async (req, res) => {
  try {
    console.log('Fetching complaints for student:', req.user._id);
    
    const complaints = await Complaint.find({ student: req.user._id })
      .populate('student', 'name rollNumber')
      .populate({
        path: 'assignedTo',
        select: 'name category phone email',
        model: 'Member'
      })
      .sort({ createdAt: -1 })
      .lean();

    console.log('Found complaints:', complaints.length);
    console.log('Sample complaint:', complaints[0] ? {
      id: complaints[0]._id,
      hasAssignedTo: !!complaints[0].assignedTo,
      assignedToDetails: complaints[0].assignedTo
    } : 'No complaints found');

    res.json({
      success: true,
      data: {
        complaints
      }
    });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching complaints',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Student: feedback on resolved complaint
export const giveFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { isSatisfied, comment } = req.body;
    const complaint = await Complaint.findOne({ _id: id, student: req.user._id });
    
    if (!complaint) {
      return res.status(404).json({ 
        success: false,
        message: 'Complaint not found' 
      });
    }

    if (complaint.currentStatus !== 'Resolved') {
      return res.status(400).json({
        success: false,
        message: 'Feedback can only be given for resolved complaints'
      });
    }

    // Add feedback
    complaint.feedback = {
      isSatisfied,
      comment,
      timestamp: new Date()
    };

    // If not satisfied, reopen the complaint
    if (!isSatisfied) {
      complaint.currentStatus = 'In Progress';
      complaint.isReopened = true;
      complaint.statusHistory.push({
        status: 'In Progress',
        timestamp: new Date(),
        note: 'Complaint reopened due to negative feedback'
      });

      // Notify admins
      const admins = await User.find({ role: { $in: ['admin', 'super_admin', 'sub_admin'] } });
      for (const admin of admins) {
        await notificationService.sendComplaintNotification(
          admin._id,
          complaint,
          complaint.student.name,
          req.user._id
        );
      }
    } else {
      // If satisfied, keep status as Resolved but lock it
      complaint.currentStatus = 'Resolved';
      complaint.isLockedForUpdates = true; // Lock the complaint
      complaint.statusHistory.push({
        status: 'Resolved',
        timestamp: new Date(),
        note: 'Complaint resolved and locked after positive feedback'
      });

      // Delete image from S3 if exists
      if (complaint.imageUrl) {
        try {
          await deleteFromS3(complaint.imageUrl);
          complaint.imageUrl = null; // Clear the image URL after deletion
        } catch (deleteError) {
          console.error('Error deleting image from S3:', deleteError);
          // Continue with status update even if image deletion fails
        }
      }

      // Notify admins
      const admins = await User.find({ role: { $in: ['admin', 'super_admin', 'sub_admin'] } });
      for (const admin of admins) {
        await notificationService.sendComplaintNotification(
          admin._id,
          complaint,
          complaint.student.name,
          req.user._id
        );
      }
    }

    await complaint.save();

    res.json({ 
      success: true, 
      data: complaint 
    });
  } catch (error) {
    console.error('Error in giveFeedback:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error giving feedback', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Student: get complaint timeline
export const getComplaintTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const complaint = await Complaint.findOne({ _id: id, student: req.user._id })
      .populate({
        path: 'assignedTo',
        select: 'name category phone email',
        model: 'Member'
      })
      .populate('student', 'name rollNumber');

    if (!complaint) {
      return res.status(404).json({ 
        success: false,
        message: 'Complaint not found' 
      });
    }

    // Get timeline from status history with populated assigned members
    const timeline = await Promise.all(complaint.statusHistory.map(async entry => {
      // For each entry, populate the assignedTo member if it exists
      let assignedMember = null;
      if (entry.assignedTo) {
        assignedMember = await Member.findById(entry.assignedTo)
          .select('name category phone email')
          .lean();
      }
      
      return {
        status: entry.status,
        note: entry.note,
        timestamp: entry.timestamp,
        assignedTo: assignedMember,
        updatedBy: entry.updatedBy ? await User.findById(entry.updatedBy).select('name role').lean() : null
      };
    }));

    // Add initial entry if no history
    if (timeline.length === 0) {
      timeline.push({
        status: complaint.currentStatus,
        note: 'Complaint created',
        timestamp: complaint.createdAt,
        assignedTo: complaint.assignedTo,
        updatedBy: null
      });
    }

    // Sort timeline by timestamp (oldest first)
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({
      success: true,
      data: {
        timeline,
        currentAssignedTo: complaint.assignedTo,
        student: complaint.student
      }
    });
  } catch (error) {
    console.error('Error fetching timeline:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching timeline' 
    });
  }
};

// Admin: list all complaints with filters
export const listAllComplaints = async (req, res) => {
  try {
    const {
      status,
      category,
      subCategory,
      fromDate,
      toDate,
      search,
      page = 1,
      limit = 10
    } = req.query;

    console.log('Filtering complaints with:', {
      status,
      category,
      subCategory,
      fromDate,
      toDate,
      search,
      page,
      limit
    });

    // Build query
    const query = {};

    // Status filter
    if (status && status !== 'All') {
      if (status === 'Active') {
        query.currentStatus = { $in: ['Received', 'Pending', 'In Progress'] };
      } else if (status === 'Resolved') {
        query.currentStatus = 'Resolved';
        query.isLockedForUpdates = false;
      } else if (status === 'Closed') {
        query.currentStatus = 'Resolved';
        query.isLockedForUpdates = true;
      } else {
        query.currentStatus = status;
      }
    }

    // Category filter
    if (category && category !== 'All') {
      query.category = category;
    }

    // Subcategory filter
    if (subCategory && subCategory !== 'All') {
      query.subCategory = subCategory;
    }

    // Date range filter
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        query.createdAt.$gte = new Date(fromDate);
      }
      if (toDate) {
        query.createdAt.$lte = new Date(toDate);
      }
    }

    // Search filter
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { 'student.name': { $regex: search, $options: 'i' } },
        { 'student.rollNumber': { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with pagination
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .populate('student', 'name rollNumber course branch gender category roomNumber')
        .populate({
          path: 'assignedTo',
          select: 'name category phone email',
          model: 'Member'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Complaint.countDocuments(query)
    ]);

    // Get counts for each status
    const statusCounts = await Complaint.aggregate([
      {
        $facet: {
          active: [
            { $match: { currentStatus: { $in: ['Received', 'Pending', 'In Progress'] } } },
            { $count: 'count' }
          ],
          resolved: [
            { $match: { currentStatus: 'Resolved', isLockedForUpdates: false } },
            { $count: 'count' }
          ],
          closed: [
            { $match: { currentStatus: 'Resolved', isLockedForUpdates: true } },
            { $count: 'count' }
          ],
          total: [
            { $count: 'count' }
          ]
        }
      }
    ]);

    const counts = {
      active: statusCounts[0].active[0]?.count || 0,
      resolved: statusCounts[0].resolved[0]?.count || 0,
      closed: statusCounts[0].closed[0]?.count || 0,
      total: statusCounts[0].total[0]?.count || 0
    };

    res.json({
      success: true,
      data: {
        complaints,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        },
        counts
      }
    });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching complaints',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: update complaint status
export const updateComplaintStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, memberId } = req.body;
    const adminId = req.admin ? req.admin._id : req.user._id;

    console.log('📝 Updating complaint status:', id, 'to:', status);
    console.log('📝 Request body:', req.body);

    const complaint = await Complaint.findById(id).populate('student', 'name email');

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Check if complaint is locked for updates
    if (complaint.isLockedForUpdates) {
      return res.status(400).json({
        success: false,
        message: 'Complaint is locked and cannot be updated'
      });
    }

    const oldStatus = complaint.currentStatus;
    
    // Handle member assignment
    if (memberId && status === 'In Progress') {
      // Validate member exists
      const member = await Member.findById(memberId);
      if (!member) {
        return res.status(400).json({
          success: false,
          message: 'Selected member not found'
        });
      }
      
      complaint.assignedTo = memberId;
      console.log('📝 Assigned complaint to member:', member.name);
    } else if (status !== 'In Progress') {
      // Clear assignment if status is not In Progress
      complaint.assignedTo = null;
    }
    
    // Use the built-in updateStatus method which handles validation and status history
    const statusNote = note || `Status updated to ${status}`;
    await complaint.updateStatus(status, statusNote);

    // Update additional fields
    complaint.resolvedBy = adminId;
    complaint.resolvedAt = status === 'Resolved' ? new Date() : null;

    await complaint.save();

    // Populate the assignedTo field for the response
    await complaint.populate('assignedTo', 'name category phone email');

    console.log('📝 Complaint status updated successfully from', oldStatus, 'to', status);

    // Send notification to student about status update
    try {
      const adminName = req.admin ? req.admin.username : req.user.name;
      
      await notificationService.sendComplaintStatusUpdate(
        complaint.student._id,
        complaint,
        status,
        adminName,
        adminId
      );

      console.log('🔔 Status update notification sent to student');
    } catch (notificationError) {
      console.error('🔔 Error sending status update notification:', notificationError);
      // Don't fail the status update if notification fails
    }

    res.status(200).json({
      success: true,
      message: 'Complaint status updated successfully',
      data: complaint
    });
  } catch (error) {
    console.error('📝 Error updating complaint status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update complaint status',
      error: error.message
    });
  }
};

// Admin: get complaint timeline
export const adminGetTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Fetching timeline for complaint ID:', id);

    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Invalid complaint ID format:', id);
      return res.status(400).json({
        success: false,
        message: 'Invalid complaint ID format'
      });
    }

    const complaint = await Complaint.findById(id)
      .populate('assignedTo', 'name category'); // Populate assignedTo for current assignment
    console.log('Found complaint:', complaint ? 'yes' : 'no');

    if (!complaint) {
      console.log('Complaint not found with ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Get timeline from status history
    const timeline = await Promise.all(complaint.statusHistory.map(async entry => {
      // For each entry, populate the assignedTo member if it exists
      let assignedMember = null;
      if (entry.assignedTo) {
        assignedMember = await Member.findById(entry.assignedTo)
          .select('name category')
          .lean();
      }
      
      return {
        status: entry.status,
        note: entry.note,
        timestamp: entry.timestamp,
        assignedTo: assignedMember
      };
    }));

    console.log('Timeline entries:', timeline.length);

    // Add initial entry if no history
    if (timeline.length === 0) {
      console.log('No timeline entries, adding initial entry');
      timeline.push({
        status: complaint.currentStatus,
        note: 'Complaint created',
        timestamp: complaint.createdAt,
        assignedTo: complaint.assignedTo // This will already be populated from the initial find
      });
    }

    res.json({
      success: true,
      data: timeline
    });
  } catch (err) {
    console.error('Error fetching complaint timeline:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaint timeline'
    });
  }
};

// Get student's complaints
export const getStudentComplaints = async (req, res) => {
  try {
    const complaints = await Complaint.find({ student: req.user._id })
      .populate('assignedTo', 'name phoneNumber category')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: complaints
    });
  } catch (err) {
    console.error('Error fetching student complaints:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaints'
    });
  }
};

// Submit feedback
export const submitFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { isSatisfied, comment } = req.body;

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Check if complaint belongs to student
    if (complaint.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to submit feedback for this complaint'
      });
    }

    // Check if complaint is resolved
    if (complaint.currentStatus !== 'Resolved') {
      return res.status(400).json({
        success: false,
        message: 'Feedback can only be submitted for resolved complaints'
      });
    }

    // Check if feedback already exists
    if (complaint.feedback) {
      return res.status(400).json({
        success: false,
        message: 'Feedback already submitted for this complaint'
      });
    }

    complaint.feedback = {
      isSatisfied,
      comment,
      timestamp: new Date()
    };

    await complaint.save();

    res.json({
      success: true,
      data: complaint
    });
  } catch (err) {
    console.error('Error submitting feedback:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback'
    });
  }
};

// Get complaint details
export const getComplaintDetails = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Fetching complaint details for ID:', id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Invalid complaint ID format:', id);
      return res.status(400).json({
        success: false,
        message: 'Invalid complaint ID format'
      });
    }

    const complaint = await Complaint.findById(id)
      .populate('student', 'name rollNumber')
      .populate({
        path: 'assignedTo',
        select: 'name category phone email',
        model: 'Member'
      })
      .lean();

    if (!complaint) {
      console.log('Complaint not found with ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Check if the complaint belongs to the student (only for student routes)
    // Skip this check for admin routes (when req.admin exists)
    if (!req.admin && complaint.student._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this complaint'
      });
    }

    res.json({
      success: true,
      data: complaint
    });
  } catch (err) {
    console.error('Error fetching complaint details:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaint details'
    });
  }
}; 