import Hostel from '../models/Hostel.js';
import HostelCategory from '../models/HostelCategory.js';
import { createError } from '../utils/error.js';

export const createHostel = async (req, res, next) => {
  try {
    const { name, code, description, isActive } = req.body;
    if (!name) {
      throw createError(400, 'Hostel name is required');
    }
    if (!code || !String(code).trim()) {
      throw createError(400, 'Hostel code is required for sequence generation');
    }
    const normalizedCode = String(code).trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(normalizedCode)) {
      throw createError(400, 'Hostel code must contain only letters and numbers');
    }
    const hostel = await Hostel.create({
      name: name.trim(),
      code: normalizedCode,
      description: description || '',
      isActive: isActive !== undefined ? isActive : true
    });
    res.status(201).json({ success: true, data: hostel });
  } catch (error) {
    next(error);
  }
};

export const updateHostel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, code, description, isActive } = req.body;
    const hostel = await Hostel.findById(id);
    if (!hostel) {
      throw createError(404, 'Hostel not found');
    }
    if (name !== undefined) hostel.name = name.trim();
    if (code !== undefined) {
      const normalizedCode = String(code).trim().toUpperCase();
      if (!normalizedCode) {
        throw createError(400, 'Hostel code cannot be empty');
      }
      if (!/^[A-Z0-9]+$/.test(normalizedCode)) {
        throw createError(400, 'Hostel code must contain only letters and numbers');
      }
      hostel.code = normalizedCode;
    }
    if (description !== undefined) hostel.description = description;
    if (isActive !== undefined) hostel.isActive = isActive;
    await hostel.save();
    res.json({ success: true, data: hostel });
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

