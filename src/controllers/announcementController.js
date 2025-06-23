import Announcement from '../models/Announcement.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import hybridNotificationService from '../utils/hybridNotificationService.js';

// Admin: create announcement
export const createAnnouncement = async (req, res) => {
  try {
    const { title, description } = req.body;
    let imageUrl = null;

    // Handle image upload if present
    if (req.file) {
      try {
        imageUrl = await uploadToS3(req.file);
      } catch (uploadError) {
        console.error('Error uploading image:', uploadError);
        return res.status(500).json({ 
          success: false, 
          message: 'Error uploading image to S3' 
        });
      }
    }

    const announcement = await Announcement.create({
      title,
      description,
      imageUrl,
      createdBy: req.user._id
    });

    // Get all students
    const students = await User.find({ role: 'student' });
    const studentIds = students.map(student => student._id);

    // Send notifications to all students using hybrid service
    await hybridNotificationService.sendAnnouncementNotification(
      studentIds,
      announcement,
      req.user.name
    );

    // Also create database notifications for in-app display
    for (const student of students) {
      await Notification.createNotification({
        recipient: student._id,
        type: 'announcement',
        title: 'New Announcement',
        message: title,
        relatedTo: announcement._id,
        onModel: 'Announcement'
      });
    }

    res.json({ success: true, data: announcement });
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ success: false, message: 'Error creating announcement', error: error.message });
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