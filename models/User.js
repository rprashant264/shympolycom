const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose'); // Import passport-local-mongoose

// Define the schema for users
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  secret: String,
  password: String,
  name: String,
  posts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'posts'
    }
  ],
  dateCreated: {
    type: Date,
    default: Date.now
  }
});

// Add passport-local-mongoose plugin
userSchema.plugin(passportLocalMongoose);

// ✅ Prevent OverwriteModelError during redeploys or serverless reloads
module.exports = mongoose.models.users || mongoose.model('users', userSchema);
