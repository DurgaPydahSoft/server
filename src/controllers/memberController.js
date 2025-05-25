import Member from '../models/Member.js';
import { validatePhoneNumber } from '../utils/validators.js';

// Get all members
export const getAllMembers = async (req, res) => {
  try {
    const members = await Member.find({ isActive: true }).sort({ category: 1, name: 1 });
    res.json({
      success: true,
      data: { members }
    });
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch members'
    });
  }
};

// Get members by category
export const getMembersByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const members = await Member.find({ category, isActive: true }).sort({ name: 1 });
    res.json({
      success: true,
      data: { members }
    });
  } catch (err) {
    console.error('Error fetching members by category:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch members by category'
    });
  }
};

// Add new member
export const addMember = async (req, res) => {
  try {
    console.log('=== Add Member Request ===');
    console.log('Request body:', req.body);
    console.log('Request user:', req.user);

    const { name, phone, category } = req.body;

    // Validate required fields
    if (!name || !phone || !category) {
      console.log('Missing required fields:', { name, phone, category });
      return res.status(400).json({
        success: false,
        message: 'Name, phone number and category are required'
      });
    }

    // Validate phone number
    if (!validatePhoneNumber(phone)) {
      console.log('Invalid phone number:', phone);
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 10-digit phone number'
      });
    }

    // If no member exists (active or inactive), create new
    console.log('Creating new member with data:', { name, phone, category });
    const member = await Member.create({
      name,
      phone,
      category,
      isActive: true
    });

    console.log('Member created successfully:', {
      id: member._id,
      name: member.name,
      phone: member.phone,
      category: member.category
    });

    res.status(201).json({
      success: true,
      data: { member },
      message: 'Member added successfully'
    });
  } catch (err) {
    console.error('=== Error adding member ===');
    console.error('Error details:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      keyPattern: err.keyPattern,
      keyValue: err.keyValue
    });
    
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors).map(e => e.message).join(', ')
      });
    }
    
    // Note: err.code === 11000 (duplicate key) for phone should not occur anymore
    // if the unique index is properly removed from MongoDB collection itself.
    // However, keeping a general 500 error for other potential issues.

    res.status(500).json({
      success: false,
      message: 'Failed to add member',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Reactivate member - This might be deprecated or re-evaluated if full duplicates are allowed
// For now, keeping it but it won't be triggered by addMember via phone duplication
export const reactivateMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category } = req.body;

    const member = await Member.findById(id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    if (member.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Member is already active'
      });
    }

    // Reactivate member
    member.isActive = true;
    member.name = name;
    member.category = category;
    await member.save();

    res.json({
      success: true,
      data: { member },
      message: 'Member reactivated successfully'
    });
  } catch (err) {
    console.error('Error reactivating member:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate member'
    });
  }
};

// Update member
export const updateMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, category } = req.body;

    // Validate required fields
    if (!name || !phone || !category) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone number and category are required'
      });
    }

    // Validate phone number
    if (!validatePhoneNumber(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 10-digit phone number'
      });
    }

    // Check if member exists
    const member = await Member.findOne({ _id: id, isActive: true });
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Update member
    member.name = name;
    member.phone = phone;
    member.category = category;
    await member.save();

    res.json({
      success: true,
      data: { member },
      message: 'Member updated successfully'
    });
  } catch (err) {
    console.error('Error updating member:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors).map(e => e.message).join(', ')
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update member'
    });
  }
};

// Delete member (soft delete)
export const deleteMember = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Invalid member ID'
      });
    }

    // Find member first to check category count
    const member = await Member.findOne({ _id: id, isActive: true });
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Check category count
    const categoryCount = await Member.countDocuments({ 
      category: member.category,
      isActive: true
    });

    if (categoryCount <= 2) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete member. Minimum 2 members required per category.'
      });
    }

    // Soft delete by setting isActive to false
    member.isActive = false;
    await member.save();

    res.json({
      success: true,
      message: 'Member deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting member:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete member'
    });
  }
}; 