import FoundLost from '../models/FoundLost.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { createError } from '../utils/error.js';
import notificationService from '../utils/notificationService.js';

// Student: Create a new found/lost post
export const createFoundLost = async (req, res, next) => {
  try {
    const { title, description, type, category } = req.body;
    const studentId = req.user._id;

    console.log('📝 Creating found/lost post for student:', studentId);
    console.log('📝 Request body:', req.body);

    const foundLost = new FoundLost({
      title,
      description,
      type,
      category,
      student: studentId
    });

    await foundLost.save();

    // Populate student details for notification
    await foundLost.populate('student', 'name email');

    console.log('📝 Found/Lost post created successfully:', foundLost._id);

    // Send notification to all admins
    try {
      const admins = await User.find({ 
        role: { $in: ['admin', 'super_admin', 'sub_admin'] } 
      });

      if (admins.length > 0) {
        const adminIds = admins.map(admin => admin._id);
        
        // Send notification to all admins
        for (const adminId of adminIds) {
          await notificationService.sendFoundLostNotification(
            adminId,
            foundLost,
            foundLost.student.name,
            studentId
          );
        }

        console.log('🔔 Found/Lost notification sent to', adminIds.length, 'admins');
      }
    } catch (notificationError) {
      console.error('🔔 Error sending found/lost notification:', notificationError);
      // Don't fail the post creation if notification fails
    }

    res.status(201).json({
      success: true,
      message: `${type === 'found' ? 'Found' : 'Lost'} item posted successfully`,
      data: foundLost
    });
  } catch (error) {
    console.error('📝 Error creating found/lost post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post',
      error: error.message
    });
  }
};

// Student: List all active found/lost posts (for browsing)
export const listAllPosts = async (req, res) => {
  try {
    const { type, category, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let query = { status: 'active' };

    // Filter by type
    if (type && ['found', 'lost'].includes(type)) {
      query.type = type;
    }

    // Filter by category
    if (category && ['Electronics', 'Books', 'Clothing', 'Accessories', 'Documents', 'Others'].includes(category)) {
      query.category = category;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const [posts, total] = await Promise.all([
      FoundLost.find(query)
        .populate('student', 'name rollNumber')
        .populate('claimedBy', 'name rollNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      FoundLost.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          total,
          limit: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching found/lost posts:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching posts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Student: List own posts
export const listMyPosts = async (req, res) => {
  try {
    console.log('Fetching found/lost posts for student:', req.user._id);
    
    const posts = await FoundLost.find({ student: req.user._id })
      .populate('student', 'name rollNumber')
      .populate('claimedBy', 'name rollNumber')
      .sort({ createdAt: -1 })
      .lean();

    console.log('Found posts:', posts.length);

    res.json({
      success: true,
      data: {
        posts
      }
    });
  } catch (error) {
    console.error('Error fetching my found/lost posts:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching posts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Student: Get post details
export const getPostDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const post = await FoundLost.findById(id)
      .populate('student', 'name rollNumber email phone')
      .populate('claimedBy', 'name rollNumber email phone');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    res.json({
      success: true,
      data: post
    });
  } catch (error) {
    console.error('Error fetching post details:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching post details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Student: Claim an item
export const claimItem = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user._id;

    const post = await FoundLost.findById(id).populate('student', 'name email');
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    if (post.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'This item is no longer available for claiming'
      });
    }

    if (post.student.toString() === studentId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot claim your own post'
      });
    }

    // Claim the item
    await post.claim(studentId);

    // Send notification to the original poster
    try {
      const notification = new Notification({
        recipient: post.student,
        title: 'Item Claimed!',
        message: `Your ${post.type === 'found' ? 'found' : 'lost'} item "${post.title}" has been claimed by ${req.user.name}`,
        type: 'foundlost',
        url: '/student/foundlost',
        priority: 10
      });
      await notification.save();
      
      console.log('🔔 Claim notification sent to original poster:', post.student);
    } catch (notificationError) {
      console.error('🔔 Error sending claim notification:', notificationError);
      // Don't fail the claim if notification fails
    }

    res.json({
      success: true,
      message: 'Item claimed successfully',
      data: post
    });
  } catch (error) {
    console.error('Error claiming item:', error);
    res.status(500).json({
      success: false,
      message: 'Error claiming item',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Student: Update own post
export const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, location, contactInfo } = req.body;
    const studentId = req.user._id;

    const post = await FoundLost.findOne({ _id: id, student: studentId });
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found or you do not have permission to edit it'
      });
    }

    if (post.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a post that is not active'
      });
    }

    // Handle image upload if present
    if (req.file) {
      try {
        // Delete old image if exists
        if (post.imageUrl) {
          await deleteFromS3(post.imageUrl);
        }
        
        const imageUrl = await uploadToS3(req.file, 'foundlost');
        post.imageUrl = imageUrl;
      } catch (uploadError) {
        console.error('Error uploading image:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload image',
          error: uploadError.message
        });
      }
    }

    // Update fields
    if (title) post.title = title;
    if (description) post.description = description;
    if (category) post.category = category;
    if (location) post.location = location;
    if (contactInfo) post.contactInfo = JSON.parse(contactInfo);

    await post.save();

    res.json({
      success: true,
      message: 'Post updated successfully',
      data: post
    });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Student: Close own post
export const closePost = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user._id;

    const post = await FoundLost.findOne({ _id: id, student: studentId });
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found or you do not have permission to close it'
      });
    }

    await post.close();

    res.json({
      success: true,
      message: 'Post closed successfully',
      data: post
    });
  } catch (error) {
    console.error('Error closing post:', error);
    res.status(500).json({
      success: false,
      message: 'Error closing post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: List all posts with admin features
export const adminListAllPosts = async (req, res) => {
  try {
    const { type, category, status, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    // Filter by type
    if (type && ['found', 'lost'].includes(type)) {
      query.type = type;
    }

    // Filter by category
    if (category && ['Electronics', 'Books', 'Clothing', 'Accessories', 'Documents', 'Others'].includes(category)) {
      query.category = category;
    }

    // Filter by status
    if (status && ['active', 'claimed', 'closed'].includes(status)) {
      query.status = status;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const [posts, total] = await Promise.all([
      FoundLost.find(query)
        .populate('student', 'name rollNumber email phone')
        .populate('claimedBy', 'name rollNumber email phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      FoundLost.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          total,
          limit: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching admin found/lost posts:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching posts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: Update post status
export const adminUpdatePostStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const post = await FoundLost.findById(id).populate('student', 'name email');
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const oldStatus = post.status;
    const statusChanged = status && status !== oldStatus;

    if (status && ['active', 'claimed', 'closed'].includes(status)) {
      post.status = status;
    }

    if (adminNotes !== undefined) {
      post.adminNotes = adminNotes;
    }

    await post.save();

    // Send notification to student if status changed
    if (statusChanged && post.student) {
      try {
        const statusMessages = {
          'claimed': 'Your found/lost item has been claimed!',
          'closed': 'Your found/lost post has been closed by admin.',
          'active': 'Your found/lost post has been reactivated by admin.'
        };

        const notificationData = {
          title: 'Found & Lost Update',
          message: statusMessages[status] || `Your post status has been updated to: ${status}`,
          type: 'foundlost',
          recipient: post.student._id,
          url: '/student/foundlost',
          priority: 10
        };

        // Create notification in database
        const notification = new Notification({
          recipient: post.student._id,
          title: 'Found & Lost Update',
          message: statusMessages[status] || `Your post status has been updated to: ${status}`,
          type: 'foundlost',
          url: '/student/foundlost',
          priority: 10
        });
        await notification.save();

        console.log('🔔 Found/Lost status update notification sent to student:', post.student._id);
      } catch (notificationError) {
        console.error('🔔 Error sending found/lost status notification:', notificationError);
        // Don't fail the status update if notification fails
      }
    }

    res.json({
      success: true,
      message: 'Post status updated successfully',
      data: post
    });
  } catch (error) {
    console.error('Error updating post status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating post status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin: Get analytics
export const getFoundLostAnalytics = async (req, res) => {
  try {
    const [totalPosts, foundPosts, lostPosts, activePosts, claimedPosts, closedPosts] = await Promise.all([
      FoundLost.countDocuments(),
      FoundLost.countDocuments({ type: 'found' }),
      FoundLost.countDocuments({ type: 'lost' }),
      FoundLost.countDocuments({ status: 'active' }),
      FoundLost.countDocuments({ status: 'claimed' }),
      FoundLost.countDocuments({ status: 'closed' })
    ]);

    // Category breakdown
    const categoryStats = await FoundLost.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentPosts = await FoundLost.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    res.json({
      success: true,
      data: {
        totalPosts,
        foundPosts,
        lostPosts,
        activePosts,
        claimedPosts,
        closedPosts,
        categoryStats,
        recentPosts
      }
    });
  } catch (error) {
    console.error('Error fetching found/lost analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}; 