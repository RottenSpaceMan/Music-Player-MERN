import mongoose from "mongoose";

const musicSchema = new mongoose.Schema({
  title: String,
  artist: String,
  path: String
})

export default mongoose.models.Music || mongoose.model('Music', musicSchema);