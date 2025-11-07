const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');  // Import passport-local-mongoose
// Database connection is handled in config/database.js

// Define the schema for users
const userschema = new mongoose.Schema({
  username: String,
  secret:String,
  password:String,
  name: String,
  posts:[
    {
      type:mongoose.Schema.Types.ObjectId,
      ref:'posts'
    }

  ],
  dateCreated: {
    type:Date,
    default:Date.now()
  }
});

// Add passport-local-mongoose to the schema
userschema.plugin(passportLocalMongoose);  // Adds methods like authenticate(), register(), etc.

module.exports=mongoose.model("users",userschema);
