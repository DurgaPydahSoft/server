import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import { createError } from '../utils/error.js';

export const createHostel = async (req, res, next) => {
  try {
    const { name, description, isActive } = req.body;
    if (!name) {
      throw createError(400, 'Hostel name is required');
    }
    const hostel = await Hostel.create({
      name: name.trim(),
      description: description || '',
      isActive: isActive !== undefined ? isActive : true
    });
    res.status(201).json({ success: true, data: hostel });
  } catch (error) {
    next(error);
  }
};

export const getHostels = async (req, res, next) => {
  try {
    const hostels = await Hostel.find().sort({ name: 1 });
    res.json({ success: true, data: hostels });
  } catch (error) {
    next(error);
  }
};

export const createHostelCategory = async (req, res, next) => {
  try {
    const { hostelId } = req.params;
    const { name, description, isActive } = req.body;
    if (!hostelId || !name) {
      throw createError(400, 'Hostel and category name are required');
    }
    const category = await HostelCategory.create({
      hostel: hostelId,
      name: name.trim(),
      description: description || '',
      isActive: isActive !== undefined ? isActive : true
    });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const getHostelCategories = async (req, res, next) => {
  try {
    const { hostelId } = req.params;
    if (!hostelId) {
      throw createError(400, 'Hostel is required');
    }
    const categories = await HostelCategory.find({ hostel: hostelId }).sort({ name: 1 });
    res.json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

