import mongoose from 'mongoose';

const mealSchema = new mongoose.Schema({
  breakfast: { type: [String], default: [] },
  lunch: { type: [String], default: [] },
  dinner: { type: [String], default: [] }
}, { _id: false });

const menuSchema = new mongoose.Schema({
  date: { type: Date, required: true, unique: true }, // The specific date for this menu
  meals: { type: mealSchema, required: true }
}, { timestamps: true });

const Menu = mongoose.model('Menu', menuSchema);
export default Menu; 