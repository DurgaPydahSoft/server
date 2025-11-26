import Complaint from '../models/Complaint.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Notification from '../models/Notification.js';
import Member from '../models/Member.js';
import AIConfig from '../models/AIConfig.js';
import mongoose from 'mongoose';
import { createError } from '../utils/error.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import notificationService from '../utils/notificationService.js';
import aiService from '../utils/aiService.js';

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
      description,
      category,
      subCategory, 
      student: studentId,
      imageUrl
    });

    await complaint.save();

    // Populate student details for notification
    await complaint.populate('student', 'name email');

    console.log('📝 Complaint created successfully:', complaint._id);

    // Check if AI is enabled for this category
    const aiConfig = await AIConfig.getConfig();
    let isAIEnabled = aiConfig?.isEnabled && aiConfig?.categories[category]?.aiEnabled;
    
    // Check if there are any active members available
    const Member = (await import('../models/Member.js')).default;
    const activeMembers = await Member.find({ isActive: true });
    
    // AI DEBUG LOGGING
    console.log('AI DEBUG: aiConfig.isEnabled:', aiConfig?.isEnabled);
    console.log('AI DEBUG: aiConfig.categories:', aiConfig?.categories);
    console.log('AI DEBUG: Complaint category:', category);
    console.log('AI DEBUG: isAIEnabled:', isAIEnabled);
    console.log('AI DEBUG: Active members:', activeMembers.map(m => ({ name: m.name, category: m.category, isActive: m.isActive })));
    
    if (activeMembers.length === 0) {
      isAIEnabled = false;
    }

    // Send notification to all admins (only once)
    try {
      const admins = await Admin.find({ 
        role: { $in: ['admin', 'super_admin', 'sub_admin'] },
        isActive: true
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
        console.log('🔔 Admin IDs:', adminIds);
        console.log('🔔 Admin details:', admins.map(a => ({ id: a._id, username: a.username, role: a.role })));
      } else {
        console.log('🔔 No active admins found for notification');
      }
    } catch (notificationError) {
      console.error('🔔 Error sending complaint notification:', notificationError);
      // Don't fail the complaint creation if notification fails
    }

    if (isAIEnabled) {
      console.log('AI DEBUG: Entering AI assignment block for complaint:', complaint._id);
      // Process AI immediately
      try {
        const aiResult = await aiService.processComplaint(complaint._id);
        console.log('AI DEBUG: aiService.processComplaint result:', aiResult);
        
        if (aiResult.success) {
          // Update the complaint with the AI result
          complaint.assignedTo = aiResult.data.assignedMember._id;
          complaint.currentStatus = 'In Progress';
          complaint.aiProcessed = true;
          complaint.aiProcessingTime = aiResult.data.processingTime;
          complaint.aiAssignedMember = aiResult.data.assignedMember._id;
          
          // Add to status history
          complaint.statusHistory.push({
            status: 'In Progress',
            timestamp: new Date(),
            note: `Complaint assigned to ${aiResult.data.assignedMember.name} - ${aiResult.data.assignedMember.category} department`
          });
          
          await complaint.save();
          console.log('AI DEBUG: Complaint after AI assignment:', complaint);
        }
      } catch (aiError) {
        console.error('AI processing error:', aiError);
      }

      res.status(201).json({
        success: true,
        message: 'Complaint submitted successfully. AI is processing your request...',
        data: { ...complaint.toObject(), _id: complaint._id, aiProcessing: true }
      });
    } else {
      // Traditional flow without AI
      console.log('🤖 AI not enabled for category:', category);

    res.status(201).json({
      success: true,
      message: 'Complaint submitted successfully',
      data: complaint
    });
    }
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
      const admins = await Admin.find({ 
        role: { $in: ['admin', 'super_admin', 'sub_admin'] },
        isActive: true
      });
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
      const admins = await Admin.find({ 
        role: { $in: ['admin', 'super_admin', 'sub_admin'] },
        isActive: true
      });
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
    console.log('📝 Raw status history:', complaint.statusHistory);
    const timeline = await Promise.all(complaint.statusHistory.map(async entry => {
      // For each entry, populate the assignedTo member if it exists
      let assignedMember = null;
      if (entry.assignedTo) {
        assignedMember = await Member.findById(entry.assignedTo)
          .select('name category phone email')
          .lean();
      }
      
      const timelineEntry = {
        status: entry.status,
        note: entry.note,
        timestamp: entry.timestamp,
        assignedTo: assignedMember,
        updatedBy: entry.updatedBy ? await User.findById(entry.updatedBy).select('name role').lean() : null
      };
      
      console.log('📝 Timeline entry:', timelineEntry);
      return timelineEntry;
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

    // Build base filter query (without status filter) for stats
    const baseFilterQuery = {};
    
    // Category filter
    if (category && category !== 'All') {
      query.category = category;
      baseFilterQuery.category = category;
    }

    // Subcategory filter
    if (subCategory && subCategory !== 'All') {
      query.subCategory = subCategory;
      baseFilterQuery.subCategory = subCategory;
    }

    // Date range filter
    if (fromDate || toDate) {
      query.createdAt = {};
      baseFilterQuery.createdAt = {};
      if (fromDate) {
        query.createdAt.$gte = new Date(fromDate);
        baseFilterQuery.createdAt.$gte = new Date(fromDate);
      }
      if (toDate) {
        query.createdAt.$lte = new Date(toDate);
        baseFilterQuery.createdAt.$lte = new Date(toDate);
      }
    }

    // Search filter
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { 'student.name': { $regex: search, $options: 'i' } },
        { 'student.rollNumber': { $regex: search, $options: 'i' } }
      ];
      baseFilterQuery.$or = [
        { description: { $regex: search, $options: 'i' } },
        { 'student.name': { $regex: search, $options: 'i' } },
        { 'student.rollNumber': { $regex: search, $options: 'i' } }
      ];
    }

    // Status filter (only for the main query, not for stats)
    if (status && status !== 'All') {
      if (status === 'Active') {
        query.currentStatus = { $in: ['Received', 'In Progress'] };
      } else if (status === 'Resolved') {
        query.currentStatus = 'Resolved';
        query.isLockedForUpdates = false;
      } else if (status === 'Closed') {
        // Support both old (Resolved + isLockedForUpdates) and new (Closed) status
        query.$or = [
          { currentStatus: 'Closed' },
          { currentStatus: 'Resolved', isLockedForUpdates: true }
        ];
      } else {
        query.currentStatus = status;
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with pagination
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .populate('student', 'name rollNumber course branch gender category roomNumber studentPhone')
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

    // Build aggregation pipeline for counts with filters
    // If search filter exists, we need to lookup student data
    const buildCountPipeline = (statusMatch) => {
      const pipeline = [];
      
      // Start with base match (category, subCategory, dateRange)
      const matchStage = {};
      
      // Category filter
      if (category && category !== 'All') {
        matchStage.category = category;
      }
      
      // Subcategory filter
      if (subCategory && subCategory !== 'All') {
        matchStage.subCategory = subCategory;
      }
      
      // Date range filter
      if (fromDate || toDate) {
        matchStage.createdAt = {};
        if (fromDate) {
          matchStage.createdAt.$gte = new Date(fromDate);
        }
        if (toDate) {
          matchStage.createdAt.$lte = new Date(toDate);
        }
      }
      
      // Add status match if provided
      if (statusMatch) {
        Object.assign(matchStage, statusMatch);
      }
      
      // Apply initial match
      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }
      
      // If search filter exists, lookup student and filter
      if (search) {
        pipeline.push({
          $lookup: {
            from: 'users',
            localField: 'student',
            foreignField: '_id',
            as: 'studentData'
          }
        });
        pipeline.push({
          $match: {
            $or: [
              { description: { $regex: search, $options: 'i' } },
              { 'studentData.name': { $regex: search, $options: 'i' } },
              { 'studentData.rollNumber': { $regex: search, $options: 'i' } }
            ]
          }
        });
      }
      
      pipeline.push({ $count: 'count' });
      return pipeline;
    };

    // Get counts for each status (applying base filters but not status filter)
    const statusCounts = await Complaint.aggregate([
      {
        $facet: {
          active: buildCountPipeline({ currentStatus: { $in: ['Received', 'Pending', 'In Progress'] } }),
          inProgress: buildCountPipeline({ currentStatus: 'In Progress' }),
          resolved: buildCountPipeline({ currentStatus: 'Resolved', isLockedForUpdates: false }),
          closed: buildCountPipeline({ 
            $or: [
              { currentStatus: 'Closed' },
              { currentStatus: 'Resolved', isLockedForUpdates: true }
            ]
          }),
          total: buildCountPipeline(null)
        }
      }
    ]);

    const counts = {
      active: statusCounts[0].active[0]?.count || 0,
      inProgress: statusCounts[0].inProgress[0]?.count || 0,
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
    const adminRole = req.admin ? req.admin.role : req.user?.role;

    console.log('📝 Updating complaint status:', id, 'to:', status);
    console.log('📝 Request body:', req.body);
    console.log('📝 Admin role:', adminRole);

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

    // Only super_admin can directly close a complaint
    if (status === 'Closed' && adminRole !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Super Admin can directly close a complaint. Please set status to "Resolved" instead.'
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
    console.log('📝 Saving status update with note:', statusNote);
    await complaint.updateStatus(status, statusNote);

    // Update additional fields
    complaint.resolvedBy = adminId;
    complaint.resolvedAt = status === 'Resolved' ? new Date() : null;

    await complaint.save();

    // Update member efficiency if complaint is resolved
    if (status === 'Resolved' && complaint.assignedTo) {
      try {
        await aiService.updateMemberEfficiency(complaint.assignedTo);
        console.log('🤖 Updated efficiency for member:', complaint.assignedTo);
      } catch (efficiencyError) {
        console.error('🤖 Error updating member efficiency:', efficiencyError);
      }
    }

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
      .populate('student', 'name rollNumber studentPhone')
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

// AI: Process complaint with AI
export const processComplaintWithAI = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🤖 Processing complaint with AI:', id);

    const complaint = await Complaint.findById(id)
      .populate('student', 'name email');
      
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    console.log('🤖 Complaint details:', {
      id: complaint._id,
      category: complaint.category,
      subCategory: complaint.subCategory,
      currentStatus: complaint.currentStatus,
      assignedTo: complaint.assignedTo,
      student: complaint.student?.name
    });

    const result = await aiService.processComplaint(complaint._id);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Complaint processed and assigned successfully',
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
        error: result.error
      });
    }
  } catch (error) {
    console.error('🤖 Error processing complaint with AI:', error);
    res.status(500).json({
      success: false,
      message: 'AI processing failed',
      error: error.message
    });
  }
};

// Admin: Get AI configuration
export const getAIConfig = async (req, res) => {
  try {
    const aiConfig = await AIConfig.getConfig();
    res.json({
      success: true,
      data: aiConfig
    });
  } catch (error) {
    console.error('Error fetching AI config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch AI configuration'
    });
  }
};

// Admin: Update AI configuration
export const updateAIConfig = async (req, res) => {
  try {
    const { isEnabled, categories, memberEfficiencyThreshold, autoStatusUpdate, maxWorkload } = req.body;
    
    const aiConfig = await AIConfig.getConfig();
    
    if (isEnabled !== undefined) aiConfig.isEnabled = isEnabled;
    if (categories) aiConfig.categories = { ...aiConfig.categories, ...categories };
    if (memberEfficiencyThreshold !== undefined) aiConfig.memberEfficiencyThreshold = memberEfficiencyThreshold;
    if (autoStatusUpdate !== undefined) aiConfig.autoStatusUpdate = autoStatusUpdate;
    if (maxWorkload !== undefined) aiConfig.maxWorkload = maxWorkload;
    
    await aiConfig.save();
    
    res.json({
      success: true,
      message: 'AI configuration updated successfully',
      data: aiConfig
    });
  } catch (error) {
    console.error('Error updating AI config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update AI configuration'
    });
  }
};

// Admin: Get AI statistics
export const getAIStats = async (req, res) => {
  try {
    const aiStats = await aiService.getAIStats();
    res.json({
      success: true,
      data: aiStats
    });
  } catch (error) {
    console.error('Error fetching AI stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch AI statistics'
    });
  }
};

// Admin: Update member efficiency
export const updateMemberEfficiency = async (req, res) => {
  try {
    const { memberId } = req.params;
    
    const result = await aiService.updateMemberEfficiency(memberId);
    
    if (result) {
      res.json({
        success: true,
        message: 'Member efficiency updated successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to update member efficiency'
      });
    }
  } catch (error) {
    console.error('Error updating member efficiency:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update member efficiency'
    });
  }
};

// Admin: Quick AI setup (enable AI for testing)
export const quickAISetup = async (req, res) => {
  try {
    const aiConfig = await AIConfig.getConfig();
    const Member = (await import('../models/Member.js')).default;
    
    // Check if members exist
    const existingMembers = await Member.find({ isActive: true });
    
    // Create sample members if none exist
    if (existingMembers.length === 0) {
      console.log('🤖 No members found, creating sample members...');
      
      const sampleMembers = [
        {
          name: 'John Maintenance',
          phone: '9876543210',
          category: 'Maintenance',
          isActive: true,
          efficiencyScore: 85,
          categoryExpertise: {
            Maintenance: 90,
            Plumbing: 85,
            Electricity: 80,
            Housekeeping: 75
          }
        },
        {
          name: 'Sarah Canteen',
          phone: '9876543211',
          category: 'Canteen',
          isActive: true,
          efficiencyScore: 88,
          categoryExpertise: {
            Canteen: 95,
            Others: 70
          }
        },
        {
          name: 'Mike Internet',
          phone: '9876543212',
          category: 'Internet',
          isActive: true,
          efficiencyScore: 92,
          categoryExpertise: {
            Internet: 98,
            Others: 75
          }
        },
        {
          name: 'Lisa Plumbing',
          phone: '9876543213',
          category: 'Plumbing',
          isActive: true,
          efficiencyScore: 87,
          categoryExpertise: {
            Maintenance: 80,
            Plumbing: 95,
            Housekeeping: 70
          }
        }
      ];
      
      await Member.insertMany(sampleMembers);
      console.log('🤖 Created', sampleMembers.length, 'sample members');
    }
    
    // Enable AI globally and for all categories
    aiConfig.isEnabled = true;
    aiConfig.categories = {
      Canteen: { aiEnabled: true, autoAssign: true },
      Internet: { aiEnabled: true, autoAssign: true },
      Maintenance: { aiEnabled: true, autoAssign: true },
      Others: { aiEnabled: true, autoAssign: true }
    };
    
    await aiConfig.save();
    
    res.json({
      success: true,
      message: `AI enabled successfully for all categories${existingMembers.length === 0 ? ' and created sample members' : ''}`,
      data: aiConfig
    });
  } catch (error) {
    console.error('Error in quick AI setup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enable AI'
    });
  }
};

// Admin: Toggle AI on/off
export const toggleAI = async (req, res) => {
  try {
    const { enabled } = req.body;
    const aiConfig = await AIConfig.getConfig();
    
    aiConfig.isEnabled = enabled;
    
    if (enabled) {
      // Enable all categories when turning on
      aiConfig.categories = {
        Canteen: { aiEnabled: true, autoAssign: true },
        Internet: { aiEnabled: true, autoAssign: true },
        Maintenance: { aiEnabled: true, autoAssign: true },
        Others: { aiEnabled: true, autoAssign: true }
      };
    }
    
    await aiConfig.save();
    
    res.json({
      success: true,
      message: `AI ${enabled ? 'enabled' : 'disabled'} successfully`,
      data: aiConfig
    });
  } catch (error) {
    console.error('Error toggling AI:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle AI',
      error: error.message
    });
  }
};

// Warden: Create complaint on behalf of student or facility issue
export const createWardenComplaint = async (req, res, next) => {
  try {
    const { 
      complaintType, 
      studentId, 
      category, 
      subCategory, 
      description, 
      priority = 'medium',
      raisedBy = 'warden'
    } = req.body;
    const wardenId = req.warden._id;

    console.log('📝 Warden creating complaint:', {
      complaintType,
      studentId,
      category,
      subCategory,
      description,
      priority,
      raisedBy
    });

    // Validate required fields
    if (!category || !description) {
      return res.status(400).json({
        success: false,
        message: 'Category and description are required'
      });
    }

    if (complaintType === 'student' && !studentId) {
      return res.status(400).json({
        success: false,
        message: 'Student ID is required for student complaints'
      });
    }

    // Validate that student exists if it's a student complaint
    if (complaintType === 'student' && studentId) {
      const student = await User.findById(studentId);
      if (!student) {
        return res.status(400).json({
          success: false,
          message: 'Selected student not found'
        });
      }
    }

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

    // Create complaint object
    const complaintData = {
      description,
      category,
      subCategory,
      imageUrl,
      priority,
      raisedBy,
      warden: wardenId,
      complaintType
    };

    // Add student reference only if it's a student complaint
    if (complaintType === 'student' && studentId) {
      complaintData.student = studentId;
    }

    const complaint = new Complaint(complaintData);
    await complaint.save();

    // Populate student details if it's a student complaint
    if (complaintType === 'student' && studentId) {
      await complaint.populate('student', 'name email rollNumber roomNumber category');
    }

    console.log('📝 Warden complaint created successfully:', complaint._id);

    // Check if AI is enabled for this category
    const aiConfig = await AIConfig.getConfig();
    let isAIEnabled = aiConfig?.isEnabled && aiConfig?.categories[category]?.aiEnabled;
    
    // Check if there are any active members available
    const activeMembers = await Member.find({ isActive: true });
    
    if (activeMembers.length === 0) {
      isAIEnabled = false;
    }

    // Send notification to all admins
    try {
      const admins = await Admin.find({ 
        role: { $in: ['admin', 'super_admin', 'sub_admin'] },
        isActive: true
      });

      if (admins.length > 0) {
        const adminIds = admins.map(admin => admin._id);
        
        // Send notification to all admins
        for (const adminId of adminIds) {
          await notificationService.sendComplaintNotification(
            adminId,
            complaint,
            complaintType === 'student' ? complaint.student?.name : 'Warden',
            complaintType === 'student' ? studentId : wardenId
          );
        }

        console.log('🔔 Warden complaint notification sent to', adminIds.length, 'admins');
      } else {
        console.log('🔔 No active admins found for notification');
      }
    } catch (notificationError) {
      console.error('🔔 Error sending warden complaint notification:', notificationError);
    }

    // Process with AI if enabled
    if (isAIEnabled) {
      try {
        console.log('🤖 Processing warden complaint with AI...');
        await aiService.processComplaint(complaint._id);
        console.log('🤖 AI processing completed for warden complaint');
      } catch (aiError) {
        console.error('🤖 Error in AI processing for warden complaint:', aiError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Complaint created successfully',
      data: complaint
    });

  } catch (error) {
    console.error('Error creating warden complaint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create complaint',
      error: error.message
    });
  }
};

// Warden: Get timeline for any complaint (student or warden raised)
export const wardenGetTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔍 Warden timeline request for ID:', id);
    
    // Validate ID
    if (!id || id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Invalid complaint ID'
      });
    }
    
    // Find the complaint
    const complaint = await Complaint.findById(id)
      .populate('student', 'name rollNumber roomNumber category')
      .populate('assignedTo', 'name category')
      .populate('warden', 'name');

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    console.log('🔍 Found complaint:', complaint._id);

    // Get timeline from status history
    const timeline = complaint.statusHistory || [];

    res.json({
      success: true,
      data: {
        timeline,
        complaint
      }
    });

  } catch (error) {
    console.error('Error fetching warden timeline:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch timeline',
      error: error.message
    });
  }
};

// Warden: List all complaints (student and facility)
export const listWardenComplaints = async (req, res) => {
  try {
    const { type, status, page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};

    // Filter by type
    if (type === 'student') {
      query.student = { $exists: true, $ne: null };
    } else if (type === 'facility') {
      query.$or = [
        { student: { $exists: false } },
        { student: null }
      ];
    } else if (type === 'warden') {
      query.raisedBy = 'warden';
    }

    // Filter by status
    if (status && status !== 'all') {
      query.status = status;
    }

    // Get complaints with pagination
    const complaints = await Complaint.find(query)
      .populate('student', 'name rollNumber roomNumber category')
      .populate('assignedTo', 'name category phone')
      .populate('warden', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Complaint.countDocuments(query);

    console.log('📝 Warden fetched complaints:', {
      type,
      status,
      count: complaints.length,
      total
    });

    res.json({
      success: true,
      data: {
        complaints,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching warden complaints:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaints',
      error: error.message
    });
  }
};

// Principal: List complaints for their course
export const listPrincipalComplaints = async (req, res) => {
  try {
    const principalId = req.user._id;
    const { type, status } = req.query;
    
    console.log('🎓 Principal complaints request:', {
      principalId,
      type,
      status,
      query: req.query
    });

    // Get principal's course - principals are in Admin model, not User model
    const principal = await Admin.findById(principalId).populate('course');
    if (!principal || !principal.course) {
      console.log('🎓 Principal or course not found:', { principal: !!principal, course: !!principal?.course });
      return res.status(400).json({
        success: false,
        message: 'Principal course not found'
      });
    }

    const courseId = principal.course._id || principal.course;
    console.log('🎓 Principal course ID:', courseId);

    // Build query
    let query = {};
    
    // Filter by course - get complaints from students in this course
    const courseStudents = await User.find({ course: courseId, role: 'student' }).distinct('_id');
    console.log('🎓 Course students count:', courseStudents.length);
    console.log('🎓 Course students:', courseStudents);
    
    query['student'] = { $in: courseStudents };
    
    // Filter by type if specified
    if (type && type !== 'all') {
      if (type === 'student') {
        query.complaintType = { $ne: 'facility' };
      } else if (type === 'facility') {
        query.complaintType = 'facility';
      } else if (type === 'warden') {
        query.raisedBy = 'warden';
      }
    }
    
    // Filter by status if specified
    if (status && status !== 'all') {
      query.currentStatus = status;
    }

    console.log('🎓 Final query:', JSON.stringify(query, null, 2));

    const complaints = await Complaint.find(query)
      .populate('student', 'name rollNumber roomNumber course branch year')
      .populate('assignedTo', 'name phone category')
      .sort({ createdAt: -1 });

    console.log('🎓 Found complaints:', complaints.length);

    res.json({
      success: true,
      data: {
        complaints,
        total: complaints.length
      }
    });

  } catch (error) {
    console.error('🎓 Error fetching principal complaints:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaints',
      error: error.message
    });
  }
};

// Principal: Get complaint timeline
export const principalGetTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const principalId = req.user._id;

    console.log('🎓 Principal timeline request:', { complaintId: id, principalId });

    // Verify principal has access to this complaint - principals are in Admin model
    const principal = await Admin.findById(principalId).populate('course');
    if (!principal || !principal.course) {
      console.log('🎓 Principal or course not found:', { principal: !!principal, course: !!principal?.course });
      return res.status(400).json({
        success: false,
        message: 'Principal course not found'
      });
    }

    const courseId = principal.course._id || principal.course;
    console.log('🎓 Principal course ID:', courseId);

    const courseStudents = await User.find({ course: courseId, role: 'student' }).distinct('_id');
    console.log('🎓 Course students count:', courseStudents.length);
    console.log('🎓 Course students:', courseStudents);

    const complaint = await Complaint.findById(id)
      .populate('student', 'name rollNumber roomNumber category')
      .populate('assignedTo', 'name category')
      .populate('warden', 'name');

    if (!complaint) {
      console.log('🎓 Complaint not found for ID:', id);
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    console.log('🎓 Complaint student ID:', complaint.student);
    console.log('🎓 Complaint student ID type:', typeof complaint.student);
    console.log('🎓 Course students types:', courseStudents.map(id => typeof id));
    
    // Convert to strings for comparison to handle ObjectId vs string issues
    const courseStudentStrings = courseStudents.map(id => id.toString());
    const complaintStudentString = complaint.student._id.toString();
    console.log('🎓 Is complaint student in course students?', courseStudentStrings.includes(complaintStudentString));

    // Check if complaint belongs to a student in principal's course
    if (!courseStudentStrings.includes(complaintStudentString)) {
      console.log('🎓 Access denied - complaint student not in principal course');
      return res.status(403).json({
        success: false,
        message: 'Access denied to this complaint'
      });
    }

    // Get timeline from status history (same as warden function)
    const timeline = complaint.statusHistory || [];
    console.log('🎓 Timeline data length:', timeline.length);
    console.log('🎓 Timeline data:', timeline);

    res.json({
      success: true,
      data: {
        timeline,
        complaint
      }
    });

  } catch (error) {
    console.error('🎓 Error fetching principal timeline:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch timeline',
      error: error.message
    });
  }
};

// Principal: Get complaint details
export const principalGetComplaintDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const principalId = req.user._id;

    console.log('🎓 Principal complaint details request:', { complaintId: id, principalId });

    // Verify principal has access to this complaint - principals are in Admin model
    const principal = await Admin.findById(principalId).populate('course');
    if (!principal || !principal.course) {
      return res.status(400).json({
        success: false,
        message: 'Principal course not found'
      });
    }

    const courseId = principal.course._id || principal.course;
    const courseStudents = await User.find({ course: courseId, role: 'student' }).distinct('_id');

    const complaint = await Complaint.findById(id)
      .populate('student', 'name rollNumber roomNumber course branch year')
      .populate('assignedTo', 'name phone category');

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Convert to strings for comparison to handle ObjectId vs string issues
    const courseStudentStrings = courseStudents.map(id => id.toString());
    const complaintStudentString = complaint.student._id.toString();

    // Check if complaint belongs to a student in principal's course
    if (!courseStudentStrings.includes(complaintStudentString)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this complaint'
      });
    }

    res.json({
      success: true,
      data: {
        complaint
      }
    });

  } catch (error) {
    console.error('🎓 Error fetching principal complaint details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaint details',
      error: error.message
    });
  }
};

// Admin: Delete complaint
export const deleteComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin ? req.admin._id : req.user._id;

    console.log('🗑️ Deleting complaint:', id, 'by admin:', adminId);

    // Validate complaint ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid complaint ID format'
      });
    }

    // Find the complaint
    const complaint = await Complaint.findById(id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Only allow deletion of complaints with 'Received' status
    if (complaint.currentStatus !== 'Received') {
      return res.status(400).json({
        success: false,
        message: 'Only complaints with "Received" status can be deleted'
      });
    }

    // Check if complaint is locked for updates
    if (complaint.isLockedForUpdates) {
      return res.status(400).json({
        success: false,
        message: 'Locked complaints cannot be deleted'
      });
    }

    // Delete image from S3 if exists
    if (complaint.imageUrl) {
      try {
        console.log('🗑️ Deleting image from S3:', complaint.imageUrl);
        await deleteFromS3(complaint.imageUrl);
        console.log('🗑️ Image deleted successfully from S3');
      } catch (deleteError) {
        console.error('🗑️ Error deleting image from S3:', deleteError);
        // Continue with complaint deletion even if image deletion fails
      }
    }

    // Delete the complaint from database
    await Complaint.findByIdAndDelete(id);

    console.log('🗑️ Complaint deleted successfully:', id);

    res.json({
      success: true,
      message: 'Complaint deleted successfully'
    });

  } catch (error) {
    console.error('🗑️ Error deleting complaint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete complaint',
      error: error.message
    });
  }
};