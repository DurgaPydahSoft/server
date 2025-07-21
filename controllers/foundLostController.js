const FoundLost = require('../models/FoundLost');
const Student = require('../models/Student');

// Create a new found/lost post
const createPost = async (req, res) => {
  try {
    const { title, description, type, category } = req.body;
    
    if (!title || !description || !type || !category) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    const post = new FoundLost({
      title,
      description,
      type,
      category,
      student: req.user._id
    });

    await post.save();

    // Populate student info
    await post.populate('student', 'name rollNumber');

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: { post }
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post'
    });
  }
};

// Get all posts with pagination and filters
const getAllPosts = async (req, res) => {
  try {
    const { type, category, search, page = 1, limit = 10 } = req.query;
    
    const query = { status: { $ne: 'closed' } };
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    if (category && category !== 'All') {
      query.category = category;
    }
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const posts = await FoundLost.find(query)
      .populate('student', 'name rollNumber')
      .populate('claimedBy', 'name rollNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await FoundLost.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          total,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts'
    });
  }
};

// Get posts by current student
const getMyPosts = async (req, res) => {
  try {
    const posts = await FoundLost.find({ student: req.user._id })
      .populate('student', 'name rollNumber')
      .populate('claimedBy', 'name rollNumber')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { posts }
    });
  } catch (error) {
    console.error('Error fetching my posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts'
    });
  }
};

// Get single post by ID
const getPostById = async (req, res) => {
  try {
    const post = await FoundLost.findById(req.params.id)
      .populate('student', 'name rollNumber')
      .populate('claimedBy', 'name rollNumber');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    res.json({
      success: true,
      data: { post }
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch post'
    });
  }
};

// Update post
const updatePost = async (req, res) => {
  try {
    const { title, description, category } = req.body;
    
    const post = await FoundLost.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the post
    if (post.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this post'
      });
    }

    // Only allow updates if post is active
    if (post.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update claimed or closed posts'
      });
    }

    post.title = title || post.title;
    post.description = description || post.description;
    post.category = category || post.category;

    await post.save();
    await post.populate('student', 'name rollNumber');

    res.json({
      success: true,
      message: 'Post updated successfully',
      data: { post }
    });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post'
    });
  }
};

// Claim an item
const claimItem = async (req, res) => {
  try {
    const post = await FoundLost.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    if (post.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Item is not available for claiming'
      });
    }

    if (post.student.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot claim your own item'
      });
    }

    await post.claim(req.user._id);
    await post.populate('student', 'name rollNumber');
    await post.populate('claimedBy', 'name rollNumber');

    res.json({
      success: true,
      message: 'Item claimed successfully',
      data: { post }
    });
  } catch (error) {
    console.error('Error claiming item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to claim item'
    });
  }
};

// Close post (delete)
const closePost = async (req, res) => {
  try {
    const post = await FoundLost.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the post or is admin
    if (post.student.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to close this post'
      });
    }

    await post.close();

    res.json({
      success: true,
      message: 'Post closed successfully'
    });
  } catch (error) {
    console.error('Error closing post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close post'
    });
  }
};

// Admin: Get analytics
const getAnalytics = async (req, res) => {
  try {
    const totalPosts = await FoundLost.countDocuments();
    const activePosts = await FoundLost.countDocuments({ status: 'active' });
    const claimedPosts = await FoundLost.countDocuments({ status: 'claimed' });
    const closedPosts = await FoundLost.countDocuments({ status: 'closed' });

    const foundItems = await FoundLost.countDocuments({ type: 'found' });
    const lostItems = await FoundLost.countDocuments({ type: 'lost' });

    const categoryStats = await FoundLost.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);

    const recentPosts = await FoundLost.find()
      .populate('student', 'name rollNumber')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      data: {
        totalPosts,
        activePosts,
        claimedPosts,
        closedPosts,
        foundItems,
        lostItems,
        categoryStats,
        recentPosts
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
};

module.exports = {
  createPost,
  getAllPosts,
  getMyPosts,
  getPostById,
  updatePost,
  claimItem,
  closePost,
  getAnalytics
}; 