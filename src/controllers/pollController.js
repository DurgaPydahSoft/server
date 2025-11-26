import Poll from '../models/Poll.js';
import { createError } from '../utils/error.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import notificationService from '../utils/notificationService.js';

// Create a new poll
export const createPoll = async (req, res, next) => {
  try {
    const { question, options, endTime, scheduledTime } = req.body;
    
    const poll = new Poll({
      question,
      options: options.map(text => ({ text, votes: 0 })),
      endTime: new Date(endTime),
      status: scheduledTime ? 'scheduled' : 'active',
      isScheduled: !!scheduledTime,
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
      createdBy: req.admin._id
    });

    await poll.save();

    // Only create notifications if the poll is not scheduled
    if (!scheduledTime) {
      // Get all students
      const students = await User.find({ role: 'student' });
      
      if (students.length > 0) {
        const studentIds = students.map(student => student._id);
        
        // Send poll notification to all students
        // Note: Admin model uses 'username' not 'name'
        await notificationService.sendPollNotification(
          studentIds,
          poll,
          req.admin.username || req.admin.name || 'Admin',
          req.admin._id
        );
      }
    }

    res.status(201).json({
      success: true,
      data: poll
    });
  } catch (error) {
    next(error);
  }
};

// Get all polls (admin)
export const getAllPolls = async (req, res, next) => {
  try {
    // First, update any polls that need status changes
    const now = new Date();
    
    // Update scheduled polls that should now be active
    await Poll.updateMany(
      { status: 'scheduled', scheduledTime: { $lte: now } },
      { $set: { status: 'active' } }
    );
    
    // Update active polls that have ended
    await Poll.updateMany(
      { status: 'active', endTime: { $lt: now } },
      { $set: { status: 'ended' } }
    );

    // Now fetch all polls with proper population
    // Note: Admin model uses 'username' not 'name'
    const polls = await Poll.find()
      .populate('createdBy', 'username role')
      .sort({ createdAt: -1 });

    const adminId = req.admin._id.toString();
    const adminRole = req.admin.role;
    const isSuperAdmin = adminRole === 'super_admin';

    // Process polls for response
    const processedPolls = polls.map((poll) => {
      // Get creator ID safely
      const creatorId = poll.createdBy?._id?.toString() || poll.createdBy?.toString() || '';
      // Admin model uses 'username' field, not 'name'
      const creatorName = poll.createdBy?.username || 'Unknown Admin';
      
      // Check if the current admin can see the results
      const isCreator = creatorId === adminId;
      const canViewResults = isSuperAdmin || isCreator;
      // Check if the current admin can manage (end/delete) this poll
      const canManage = isSuperAdmin || isCreator;
      
      // Convert to object and add flags
      const pollObj = poll.toObject();
      pollObj.canViewResults = canViewResults;
      pollObj.canManage = canManage;
      pollObj.isCreator = isCreator;
      pollObj.creatorName = creatorName;
      
      // If admin cannot view results, hide vote counts
      if (!canViewResults) {
        pollObj.options = pollObj.options.map(opt => ({
          ...opt,
          votes: 0  // Hide actual votes
        }));
        pollObj.voters = []; // Hide voters list
      }
      
      return pollObj;
    });

    res.json({
      success: true,
      data: processedPolls
    });
  } catch (error) {
    next(error);
  }
};

// Get active polls (student/warden)
export const getActivePolls = async (req, res, next) => {
  try {
    // First update any polls that have passed their end time or scheduled time
    await Poll.updateMany(
      {
        $or: [
          { status: 'active', endTime: { $lt: new Date() } },
          { status: 'scheduled', scheduledTime: { $lte: new Date() } }
        ]
      },
      { $set: { status: 'ended' } }
    );

    const polls = await Poll.find({
      status: 'active',
      endTime: { $gt: new Date() }
    }).populate('createdBy', 'name');

    // Check for polls ending within 1 hour
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    const endingPolls = polls.filter(poll => poll.endTime <= oneHourFromNow);

    // Create notifications for admin about polls ending soon
    if (endingPolls.length > 0) {
      // Check for existing notifications for these polls
      const existingNotifications = await Notification.find({
        type: 'poll_ending',
        relatedId: { $in: endingPolls.map(poll => poll._id) },
        createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) } // Within last hour
      });

      // Create a set of poll IDs that already have notifications
      const notifiedPollIds = new Set(existingNotifications.map(n => n.relatedId.toString()));

      // Only create notifications for polls that don't already have one
      const pollsNeedingNotification = endingPolls.filter(poll => !notifiedPollIds.has(poll._id.toString()));

      if (pollsNeedingNotification.length > 0) {
        await Promise.all(pollsNeedingNotification.map(poll =>
          notificationService.sendPollEndingNotification(
            [poll.createdBy._id],
            poll
          )
        ));
      }
    }

    // Add hasVoted flag for each poll and sort by creation date (newest first)
    let pollsWithVoteStatus = polls.map(poll => ({
      ...poll.toObject(),
      hasVoted: false // Default for wardens
    }));

    // If it's a student request, check voting status
    if (req.user) {
      pollsWithVoteStatus = polls.map(poll => ({
        ...poll.toObject(),
        hasVoted: poll.voters.some(voter => voter.student.toString() === req.user._id.toString())
      }));
    }

    // Sort by creation date (newest first)
    pollsWithVoteStatus.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: pollsWithVoteStatus
    });
  } catch (error) {
    next(error);
  }
};

// Vote on a poll
export const votePoll = async (req, res, next) => {
  try {
    const { pollId } = req.params;
    const { optionIndex } = req.body;

    const poll = await Poll.findById(pollId);
    
    if (!poll) {
      throw createError(404, 'Poll not found');
    }

    if (poll.status === 'ended' || new Date() > poll.endTime) {
      throw createError(400, 'Poll has ended');
    }

    if (poll.hasVoted(req.user._id)) {
      throw createError(400, 'You have already voted on this poll');
    }

    if (optionIndex < 0 || optionIndex >= poll.options.length) {
      throw createError(400, 'Invalid option');
    }

    // Add vote
    poll.options[optionIndex].votes += 1;
    poll.voters.push({
      student: req.user._id,
      votedOption: optionIndex
    });

    await poll.save();

    res.json({
      success: true,
      data: poll.getResults()
    });
  } catch (error) {
    next(error);
  }
};

// End a poll
export const endPoll = async (req, res, next) => {
  try {
    const { pollId } = req.params;
    const adminId = req.admin._id.toString();
    const isSuperAdmin = req.admin.role === 'super_admin';

    const poll = await Poll.findById(pollId);
    
    if (!poll) {
      throw createError(404, 'Poll not found');
    }

    // Check if the admin has permission to end this poll
    const isCreator = poll.createdBy.toString() === adminId;
    if (!isSuperAdmin && !isCreator) {
      throw createError(403, 'You can only end polls that you created');
    }

    if (poll.status === 'ended') {
      throw createError(400, 'Poll is already ended');
    }

    poll.status = 'ended';
    await poll.save();

    res.json({
      success: true,
      data: poll
    });
  } catch (error) {
    next(error);
  }
};

// Delete a poll
export const deletePoll = async (req, res, next) => {
  try {
    const { pollId } = req.params;
    const adminId = req.admin._id.toString();
    const isSuperAdmin = req.admin.role === 'super_admin';

    const poll = await Poll.findById(pollId);
    
    if (!poll) {
      throw createError(404, 'Poll not found');
    }

    // Check if the admin has permission to delete this poll
    const isCreator = poll.createdBy.toString() === adminId;
    if (!isSuperAdmin && !isCreator) {
      throw createError(403, 'You can only delete polls that you created');
    }

    await poll.deleteOne();

    res.json({
      success: true,
      message: 'Poll deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get poll results
export const getPollResults = async (req, res, next) => {
  try {
    const { pollId } = req.params;

    const poll = await Poll.findById(pollId);
    
    if (!poll) {
      throw createError(404, 'Poll not found');
    }

    res.json({
      success: true,
      data: {
        question: poll.question,
        results: poll.getResults(),
        totalVotes: poll.getTotalVotes(),
        hasVoted: poll.hasVoted(req.user._id)
      }
    });
  } catch (error) {
    next(error);
  }
}; 