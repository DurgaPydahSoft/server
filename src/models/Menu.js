import mongoose from 'mongoose';

const mealSchema = new mongoose.Schema({
  breakfast: { type: [String], default: [] },
  lunch: { type: [String], default: [] },
  dinner: { type: [String], default: [] }
}, { _id: false });

// Rating schema for individual meals
const mealRatingSchema = new mongoose.Schema({
  mealType: { type: String, enum: ['breakfast', 'lunch', 'dinner'], required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  comment: { type: String, maxlength: 500 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const menuSchema = new mongoose.Schema({
  date: { type: Date, required: true, unique: true }, // The specific date for this menu
  meals: { type: mealSchema, required: true },
  ratings: [mealRatingSchema] // Array of ratings for this day's meals
}, { timestamps: true });

// Index for efficient querying
menuSchema.index({ date: 1 });
menuSchema.index({ 'ratings.studentId': 1, date: 1 });

const Menu = mongoose.model('Menu', menuSchema);
export default Menu; 