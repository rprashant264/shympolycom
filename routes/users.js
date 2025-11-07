const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');  // Import passport-local-mongoose
//for docker MongoDB mongoose.connect("mongodb://admin:admin123@localhost:27017/myapp?authSource=admin")
// for local MongoDB connection
mongoose.connect("mongodb://127.0.0.1:27017/myapp")
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

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

