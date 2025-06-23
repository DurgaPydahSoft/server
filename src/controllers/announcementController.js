import Announcement from '../models/Announcement.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import notificationService from '../utils/notificationService.js';

// Admin: create announcement
export const createAnnouncement = async (req, res) => {
  try {
    const { title, description, priority, targetAudience } = req.body;
    const adminId = req.admin._id;
    let imageUrl = null;

    console.log('📢 Creating announcement:', title);

    // Handle image upload if a file is present
    if (req.file) {
      try {
        console.log('🖼️ Uploading image to S3...');
        imageUrl = await uploadToS3(req.file, 'announcements');
        console.log('🖼️ Image uploaded successfully:', imageUrl);
      } catch (uploadError) {
        console.error('🖼️ S3 upload failed:', uploadError);
        // Decide if you want to fail or continue without an image
        return res.status(500).json({
          success: false,
          message: 'Image upload failed',
          error: uploadError.message,
        });
      }
    }

    const announcement = new Announcement({
      title,
      description,
      priority,
      targetAudience,
      imageUrl,
      createdBy: adminId
    });

    await announcement.save();

    console.log('📢 Announcement created successfully:', announcement._id);

    // Send notification to all students
    try {
      const students = await User.find({ role: 'student' });
      
      if (students.length > 0) {
        const studentIds = students.map(student => student._id);
        
        await notificationService.sendAnnouncementNotification(
          studentIds,
          announcement,
          req.admin.name,
          adminId
        );

        console.log('🔔 Announcement notification sent to students:', studentIds.length);
      }
    } catch (notificationError) {
      console.error('🔔 Error sending announcement notification:', notificationError);
      // Don't fail the announcement creation if notification fails
    }

    res.status(201).json({
      success: true,
      message: 'Announcement created successfully',
      data: announcement
    });
  } catch (error) {
    console.error('📢 Error creating announcement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create announcement',
      error: error.message
    });
  }
};

// List all announcements (active)
export const listAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: announcements });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching announcements', error: error.message });
  }
};

// List all announcements (admin, active and inactive)
export const listAllAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json({ success: true, data: announcements });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching announcements', error: error.message });
  }
};

// Admin: delete announcement
export const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const announcement = await Announcement.findById(id);
    
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    // Delete image from S3 if exists
    if (announcement.imageUrl) {
      try {
        await deleteFromS3(announcement.imageUrl);
      } catch (deleteError) {
        console.error('Error deleting image from S3:', deleteError);
        // Continue with announcement deletion even if image deletion fails
      }
    }

    // Delete the announcement from MongoDB
    await Announcement.findByIdAndDelete(id);
    
    res.json({ success: true, message: 'Announcement deleted successfully' });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ success: false, message: 'Error deleting announcement', error: error.message });
  }
}; 