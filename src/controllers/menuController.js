import Menu from '../models/Menu.js';
import { createError } from '../utils/error.js';
import User from '../models/User.js';
import notificationService from '../utils/notificationService.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import multer from 'multer';
import Attendance from '../models/Attendance.js';
import StaffAttendance from '../models/StaffAttendance.js';
import StaffGuest from '../models/StaffGuest.js';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Helper to normalize date to YYYY-MM-DD (no time)
function normalizeDate(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Helper function to process menu items and upload images
const processMenuItems = async (meals) => {
  const processedMeals = {};
  
  for (const mealType of ['breakfast', 'lunch', 'snacks', 'dinner']) {
    processedMeals[mealType] = [];
    
    if (meals[mealType] && Array.isArray(meals[mealType])) {
      for (const item of meals[mealType]) {
        if (typeof item === 'string') {
          // Handle legacy string format
          processedMeals[mealType].push({ name: item, imageUrl: null });
        } else if (item && typeof item === 'object') {
          // Handle new object format
          const menuItem = { name: item.name, imageUrl: null };
          
          // If there's an image file, upload it
          if (item.imageFile && item.imageFile.buffer) {
            try {
              // The file is already a multer file object
              const imageUrl = await uploadToS3(item.imageFile, 'menu');
              menuItem.imageUrl = imageUrl;
            } catch (error) {
              console.error('Error uploading image:', error);
              // Continue without image if upload fails
            }
          } else if (item.imageUrl) {
            // Keep existing image URL
            menuItem.imageUrl = item.imageUrl;
          }
          
          processedMeals[mealType].push(menuItem);
        }
      }
    }
  }
  
  return processedMeals;
};

// Create or update menu for a specific date
export const createOrUpdateMenuForDate = async (req, res, next) => {
  try {
    let { date, meals } = req.body;
    
               // Handle FormData requests
           if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
             date = req.body.date;
             meals = JSON.parse(req.body.meals);
             
             // Process uploaded images using image flags for correct matching
             for (const mealType of ['breakfast', 'lunch', 'snacks', 'dinner']) {
               if (meals[mealType] && Array.isArray(meals[mealType])) {
                 for (let i = 0; i < meals[mealType].length; i++) {
                   const item = meals[mealType][i];
                   
                   // Use image flags to correctly match files
                   // hasImage and imageIndex are set by frontend to indicate which items have images
                   if (item.hasImage && item.imageIndex !== null && item.imageIndex !== undefined) {
                     const fileKey = `image_${mealType}_${item.imageIndex}`;
                     const uploadedFile = req.files ? req.files.find(f => f.fieldname === fileKey) : null;
                     
                     if (uploadedFile) {
                       try {
                         const imageUrl = await uploadToS3(uploadedFile, 'menu');
                         item.imageUrl = imageUrl;
                         console.log(`✅ Successfully uploaded image for ${mealType} item "${item.name}": ${imageUrl}`);
                       } catch (error) {
                         console.error(`❌ Error uploading image for ${mealType} item "${item.name}":`, error);
                         // Continue without image if upload fails
                       }
                     } else {
                       console.warn(`⚠️ No file found for ${mealType} item "${item.name}" with key: ${fileKey}`);
                     }
                   }
                   
                   // Clean up temporary properties used for file matching
                   if (item.hasImage !== undefined) {
                     delete item.hasImage;
                   }
                   if (item.imageIndex !== undefined) {
                     delete item.imageIndex;
                   }
                   // Remove the imageFile property as it's not needed in the database
                   if (item.imageFile) {
                     delete item.imageFile;
                   }
                 }
               }
             }
           }
    
    if (!date || !meals) {
      throw createError(400, 'date and meals are required');
    }
    
    const normDate = normalizeDate(date);
    let menu = await Menu.findOne({ date: normDate });
    
    if (menu) {
      // Store old image URLs before updating
      const oldImageUrls = [];
      for (const mealType of ['breakfast', 'lunch', 'snacks', 'dinner']) {
        if (menu.meals[mealType]) {
          menu.meals[mealType].forEach(item => {
            if (item.imageUrl) {
              oldImageUrls.push(item.imageUrl);
            }
          });
        }
      }
      
      // Update menu with new meals
      menu.meals = meals;
      await menu.save();
      
      // Find images that are no longer in use and delete them
      const newImageUrls = [];
      for (const mealType of ['breakfast', 'lunch', 'snacks', 'dinner']) {
        if (meals[mealType]) {
          meals[mealType].forEach(item => {
            if (item.imageUrl) {
              newImageUrls.push(item.imageUrl);
            }
          });
        }
      }
      
      // Delete only the images that are no longer in use
      const imagesToDelete = oldImageUrls.filter(url => !newImageUrls.includes(url));
      for (const imageUrl of imagesToDelete) {
        try {
          await deleteFromS3(imageUrl);
          console.log(`🗑️ Deleted unused menu image: ${imageUrl}`);
        } catch (error) {
          console.error('Error deleting unused image:', error);
        }
      }
    } else {
      menu = await Menu.create({ date: normDate, meals });
    }
    console.log('Saved menu document:', menu);

    // Send response immediately, don't wait for notifications
    res.json({ success: true, data: menu });

    // Send notification asynchronously (non-blocking) if menu is for today
    const today = normalizeDate(new Date());
    if (normDate.getTime() === today.getTime()) {
      // Run notification in background, don't block the response
      // Use process.nextTick to ensure it runs after response is sent
      process.nextTick(async () => {
        try {
          const students = await User.find({ role: 'student' });
          
          if (students.length > 0) {
            const studentIds = students.map(student => student._id);
            
            await notificationService.sendToUsers(studentIds, {
              type: 'menu',
              title: 'Menu Update',
              message: '🍽️ check out today\'s menu! Tap to see what\'s cooking.',
              sender: req.admin ? req.admin._id : null,
              onModel: 'Menu',
              relatedId: menu._id
            });

            console.log('🍽️ Menu notification sent to students:', studentIds.length);
          }
        } catch (notificationError) {
          console.error('🍽️ Error sending menu notification:', notificationError);
          // Don't fail the menu update if notification fails
        }
      });
    }
  } catch (error) {
    next(error);
  }
};

// Get menu for a specific date
export const getMenuForDate = async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) throw createError(400, 'date is required');
    const normDate = normalizeDate(date);
    const menu = await Menu.findOne({ date: normDate });
    if (!menu) throw createError(404, 'Menu for this date not found');
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Get today's menu (for student dashboard)
export const getMenuForToday = async (req, res, next) => {
  try {
    const today = normalizeDate(new Date());
    const menu = await Menu.findOne({ date: today });
    if (!menu) throw createError(404, 'Menu for today not found');
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Get today's menu with user's ratings (for student dashboard)
export const getMenuForTodayWithRatings = async (req, res, next) => {
  try {
    const today = normalizeDate(new Date());
    const menu = await Menu.findOne({ date: today });
    if (!menu) throw createError(404, 'Menu for today not found');
    
    // Get user's ratings for today
    const userRatings = menu.ratings.filter(rating => 
      rating.studentId.toString() === req.user.id
    );
    
    // Calculate average ratings for each meal
    const avgRatings = {};
    ['breakfast', 'lunch', 'snacks', 'dinner'].forEach(mealType => {
      const mealRatings = menu.ratings.filter(r => r.mealType === mealType);
      if (mealRatings.length > 0) {
        const total = mealRatings.reduce((sum, r) => sum + r.rating, 0);
        avgRatings[mealType] = {
          average: Math.round((total / mealRatings.length) * 10) / 10,
          totalRatings: mealRatings.length
        };
      } else {
        avgRatings[mealType] = { average: 0, totalRatings: 0 };
      }
    });
    
    res.json({ 
      success: true, 
      data: {
        ...menu.toObject(),
        userRatings,
        avgRatings
      }
    });
  } catch (error) {
    next(error);
  }
};

// Submit a rating for a meal
export const submitMealRating = async (req, res, next) => {
  try {
    const { date, mealType, rating, comment } = req.body;
    const studentId = req.user.id;
    
    if (!date || !mealType || !rating) {
      throw createError(400, 'date, mealType, and rating are required');
    }
    
    if (!['breakfast', 'lunch', 'snacks', 'dinner'].includes(mealType)) {
      throw createError(400, 'Invalid meal type');
    }
    
    if (rating < 1 || rating > 5) {
      throw createError(400, 'Rating must be between 1 and 5');
    }
    
    const normDate = normalizeDate(date);
    let menu = await Menu.findOne({ date: normDate });
    
    if (!menu) {
      throw createError(404, 'Menu for this date not found');
    }
    
    // Check if user already rated this meal
    const existingRatingIndex = menu.ratings.findIndex(r => 
      r.studentId.toString() === studentId && r.mealType === mealType
    );
    
    const newRating = {
      mealType,
      rating,
      studentId,
      comment: comment || '',
      createdAt: new Date()
    };
    
    if (existingRatingIndex !== -1) {
      // Update existing rating
      menu.ratings[existingRatingIndex] = newRating;
    } else {
      // Add new rating
      menu.ratings.push(newRating);
    }
    
    await menu.save();
    
    res.json({ 
      success: true, 
      message: 'Rating submitted successfully',
      data: newRating
    });
  } catch (error) {
    next(error);
  }
};

// Get user's rating for a specific meal
export const getUserMealRating = async (req, res, next) => {
  try {
    const { date, mealType } = req.query;
    const studentId = req.user.id;
    
    if (!date || !mealType) {
      throw createError(400, 'date and mealType are required');
    }
    
    const normDate = normalizeDate(date);
    const menu = await Menu.findOne({ date: normDate });
    
    if (!menu) {
      throw createError(404, 'Menu for this date not found');
    }
    
    const userRating = menu.ratings.find(r => 
      r.studentId.toString() === studentId && r.mealType === mealType
    );
    
    res.json({ 
      success: true, 
      data: userRating || null
    });
  } catch (error) {
    next(error);
  }
};

// Get rating statistics for admin
export const getRatingStats = async (req, res, next) => {
  try {
    const { date } = req.query;
    const normDate = normalizeDate(date || new Date());
    
    const menu = await Menu.findOne({ date: normDate });
    if (!menu) {
      throw createError(404, 'Menu for this date not found');
    }
    
    const stats = {};
    ['breakfast', 'lunch', 'snacks', 'dinner'].forEach(mealType => {
      const mealRatings = menu.ratings.filter(r => r.mealType === mealType);
      
      if (mealRatings.length > 0) {
        const total = mealRatings.reduce((sum, r) => sum + r.rating, 0);
        const average = Math.round((total / mealRatings.length) * 10) / 10;
        
        // Count ratings by star
        const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        mealRatings.forEach(r => {
          ratingCounts[r.rating]++;
        });
        
        stats[mealType] = {
          average,
          totalRatings: mealRatings.length,
          ratingCounts,
          comments: mealRatings.filter(r => r.comment).map(r => ({
            rating: r.rating,
            comment: r.comment,
            createdAt: r.createdAt
          }))
        };
      } else {
        stats[mealType] = {
          average: 0,
          totalRatings: 0,
          ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          comments: []
        };
      }
    });
    
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

// Add a new item to a specific meal for a date
export const addMenuItemForDate = async (req, res, next) => {
  try {
    const { date, mealType, item } = req.body;
    if (!date || !mealType || !item) {
      throw createError(400, 'date, mealType, and item are required');
    }
    const normDate = normalizeDate(date);
    let menu = await Menu.findOne({ date: normDate });
    if (!menu) {
      // Create menu for date if not exists
      menu = await Menu.create({ date: normDate, meals: { breakfast: [], lunch: [], snacks: [], dinner: [] } });
    }
    if (!menu.meals[mealType]) throw createError(400, 'Invalid meal type');
    
    // Handle both string and object formats
    const menuItem = typeof item === 'string' ? { name: item, imageUrl: null } : item;
    
    // Check if item already exists
    const existingItem = menu.meals[mealType].find(existing => 
      existing.name.toLowerCase() === menuItem.name.toLowerCase()
    );
    
    if (!existingItem) {
      menu.meals[mealType].push(menuItem);
      await menu.save();

      // Send notification if menu is for today
      const today = normalizeDate(new Date());
      if (normDate.getTime() === today.getTime()) {
        try {
          const students = await User.find({ role: 'student' });
          
          if (students.length > 0) {
            const studentIds = students.map(student => student._id);
            
            await notificationService.sendMenuNotification(
              studentIds,
              menu,
              req.admin ? req.admin.name : 'Admin',
              req.admin ? req.admin._id : null
            );

            console.log('🍽️ Menu item added notification sent to students:', studentIds.length);
          }
        } catch (notificationError) {
          console.error('🍽️ Error sending menu notification:', notificationError);
          // Don't fail the menu update if notification fails
        }
      }
    }
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Remove an item from a specific meal for a date
export const deleteMenuItemForDate = async (req, res, next) => {
  try {
    const { date, mealType, itemName } = req.body;
    if (!date || !mealType || !itemName) {
      throw createError(400, 'date, mealType, and itemName are required');
    }
    const normDate = normalizeDate(date);
    const menu = await Menu.findOne({ date: normDate });
    if (!menu) throw createError(404, 'Menu for this date not found');
    if (!menu.meals[mealType]) throw createError(400, 'Invalid meal type');
    
    // Find the item to delete and get its image URL
    const itemToDelete = menu.meals[mealType].find(item => item.name === itemName);
    const imageUrlToDelete = itemToDelete ? itemToDelete.imageUrl : null;
    
    // Remove the item
    menu.meals[mealType] = menu.meals[mealType].filter(item => item.name !== itemName);
    await menu.save();
    
    // Delete the image from S3 if it exists
    if (imageUrlToDelete) {
      try {
        await deleteFromS3(imageUrlToDelete);
      } catch (error) {
        console.error('Error deleting image from S3:', error);
      }
    }
    
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Cleanup old menu images (run this periodically)
export const cleanupOldMenuImages = async (req, res, next) => {
  try {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    
    // Find menus older than 10 days
    const oldMenus = await Menu.find({
      date: { $lt: tenDaysAgo }
    });
    
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const menu of oldMenus) {
      for (const mealType of ['breakfast', 'lunch', 'snacks', 'dinner']) {
        if (menu.meals[mealType]) {
          for (const item of menu.meals[mealType]) {
            if (item.imageUrl) {
              try {
                await deleteFromS3(item.imageUrl);
                deletedCount++;
                console.log(`🧹 Deleted old menu image: ${item.imageUrl}`);
              } catch (error) {
                console.error('Error deleting old menu image:', error);
                errorCount++;
              }
            }
          }
        }
      }
    }
    
    console.log(`🧹 Cleanup completed: ${deletedCount} images deleted, ${errorCount} errors`);
    
    if (req && res) {
      res.json({ 
        success: true, 
        deletedCount, 
        errorCount,
        message: `Cleaned up ${deletedCount} old menu images`
      });
    }
  } catch (error) {
    console.error('Error in cleanupOldMenuImages:', error);
    if (req && res) {
      next(error);
    }
  }
};

// Delete multiple images from S3
export const deleteMenuImages = async (req, res, next) => {
  try {
    const { imageUrls } = req.body;
    
    if (!imageUrls || !Array.isArray(imageUrls)) {
      throw createError(400, 'imageUrls array is required');
    }
    
    console.log('🗑️ Received request to delete images:', imageUrls);
    
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const imageUrl of imageUrls) {
      if (imageUrl) {
        try {
          console.log(`🗑️ Attempting to delete: ${imageUrl}`);
          await deleteFromS3(imageUrl);
          deletedCount++;
          console.log(`🗑️ Successfully deleted menu image: ${imageUrl}`);
        } catch (error) {
          console.error('Error deleting menu image:', error);
          errorCount++;
        }
      }
    }
    
    console.log(`🗑️ Deletion summary: ${deletedCount} successful, ${errorCount} errors`);
    
    res.json({ 
      success: true, 
      deletedCount, 
      errorCount,
      message: `Deleted ${deletedCount} images from S3`
    });
  } catch (error) {
    next(error);
  }
};

// Function to run cleanup automatically (can be called by cron job)
export const runMenuImageCleanup = async () => {
  try {
    console.log('🧹 Starting automatic menu image cleanup...');
    await cleanupOldMenuImages();
    console.log('🧹 Automatic menu image cleanup completed');
  } catch (error) {
    console.error('Error in automatic menu image cleanup:', error);
  }
};

// Test S3 connectivity and bucket access
export const testS3Access = async (req, res, next) => {
  try {
    console.log('🔍 Testing S3 access...');
    
    // Test bucket access
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
      },
    });
    
    const bucketName = process.env.AWS_S3_BUCKET;
    const command = new HeadBucketCommand({ Bucket: bucketName });
    
    try {
      await s3Client.send(command);
      console.log('✅ S3 bucket access successful');
      
      res.json({ 
        success: true, 
        message: 'S3 bucket access successful',
        bucket: bucketName,
        region: process.env.AWS_REGION
      });
    } catch (error) {
      console.error('❌ S3 bucket access failed:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message,
        bucket: bucketName,
        region: process.env.AWS_REGION
      });
    }
  } catch (error) {
    next(error);
  }
};

// Helper function to determine current session
// Session timings match the attendance system (IST):
// Morning: 7:30 AM - 9:30 AM (7.5 - 9.5)
// Evening: 5:00 PM - 7:00 PM (17 - 19)
// Night: 8:00 PM - 10:00 PM (20 - 22)
const getCurrentSession = () => {
  const now = new Date();
  // Convert to IST (Asia/Kolkata timezone)
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const hour = istTime.getHours() + (istTime.getMinutes() / 60);
  
  // Morning session: 7:30 AM - 9:30 AM
  if (hour >= 7.5 && hour < 9.5) {
    return { session: 'morning', date: normalizeDate(istTime), description: 'Based on today\'s morning attendance' };
  }
  // Evening session: 5:00 PM - 7:00 PM
  else if (hour >= 17 && hour < 19) {
    return { session: 'evening', date: normalizeDate(istTime), description: 'Based on today\'s evening attendance' };
  }
  // Night session: 8:00 PM - 10:00 PM
  else if (hour >= 20 && hour < 22) {
    return { session: 'night', date: normalizeDate(istTime), description: 'Based on today\'s night attendance' };
  }
  // After night session (after 10:00 PM) or before morning session (before 7:30 AM): use yesterday's night attendance
  else {
    const yesterday = new Date(istTime);
    yesterday.setDate(yesterday.getDate() - 1);
    return { session: 'night', date: normalizeDate(yesterday), description: 'Based on yesterday\'s night attendance' };
  }
};

// Get food preparation count based on recent session attendance
export const getFoodPreparationCount = async (req, res, next) => {
  try {
    // Determine current session and date
    const { session, date, description } = getCurrentSession();

    console.log('🍽️ Getting food preparation count for session:', session, 'date:', date);

    // Get students who were present for the determined session
    const studentAttendance = await Attendance.find({
      date: date,
      [session]: true
    }).populate('student', '_id name rollNumber mealType');

    // Get staff/guests who were present for the determined session
    const staffAttendance = await StaffAttendance.find({
      date: date,
      [session]: true
    }).populate('staffId', '_id name type');

    // Count unique students (in case of duplicate records)
    const uniqueStudents = new Set();
    let vegCount = 0;
    let nonVegCount = 0;

    studentAttendance.forEach(att => {
      if (att.student && att.student._id) {
        const studentId = att.student._id.toString();
        if (!uniqueStudents.has(studentId)) {
          uniqueStudents.add(studentId);
          
          // Count meal types
          if (att.student.mealType === 'veg') {
            vegCount++;
          } else {
            // Default to non-veg if not specified or explicitly non-veg
            nonVegCount++;
          }
        }
      }
    });

    // Count unique staff/guests
    const uniqueStaff = new Set();
    staffAttendance.forEach(att => {
      if (att.staffId && att.staffId._id) {
        uniqueStaff.add(att.staffId._id.toString());
      }
    });

    const studentCount = uniqueStudents.size;
    const staffCount = uniqueStaff.size;
    const totalCount = studentCount + staffCount;

    console.log('🍽️ Food count results:', {
      session,
      studentCount,
      vegCount,
      nonVegCount,
      staffCount,
      totalCount,
      studentRecords: studentAttendance.length,
      staffRecords: staffAttendance.length
    });

    // Get additional info for breakdown
    const studentDetails = studentAttendance
      .filter(att => att.student && att.student._id)
      .map(att => ({
        id: att.student._id,
        name: att.student.name,
        rollNumber: att.student.rollNumber,
        mealType: att.student.mealType || 'non-veg'
      }));

    const staffDetails = staffAttendance
      .filter(att => att.staffId && att.staffId._id)
      .map(att => ({
        id: att.staffId._id,
        name: att.staffId.name,
        type: att.staffId.type
      }));

    res.json({
      success: true,
      data: {
        date: date,
        session: session,
        description: description,
        counts: {
          students: studentCount,
          vegStudents: vegCount,
          nonVegStudents: nonVegCount,
          staff: staffCount,
          total: totalCount
        },
        details: {
          students: studentDetails,
          staff: staffDetails
        },
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Error getting food preparation count:', error);
    
    // Return empty data instead of throwing error
    const { session, description } = getCurrentSession();
    res.json({
      success: true,
      data: {
        date: new Date(),
        session: session,
        description: description,
        counts: {
          students: 0,
          vegStudents: 0,
          nonVegStudents: 0,
          staff: 0,
          total: 0
        },
        details: {
          students: [],
          staff: []
        },
        lastUpdated: new Date(),
        error: 'No attendance data available'
      }
    });
  }
}; 