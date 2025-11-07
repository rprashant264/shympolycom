const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      
    },
    description: {
      type: String,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users", // Reference to the User model
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const Post = mongoose.model("posts", postSchema);

module.exports = Post;
