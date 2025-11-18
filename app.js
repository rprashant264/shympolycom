require('dotenv').config();
const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const flash = require('connect-flash');

// Routers
const indexRouter = require('./routes/index');

// Models
const User = require('./models/User'); // ✅ Make sure you have this file

const app = express();

// -------------------- DATABASE CONNECTION --------------------
// MongoDB connection is handled in config/database.js

// -------------------- SESSION CONFIGURATION --------------------
const sessionConfig = {
  name: 'session',
  secret: process.env.SESSION_SECRET || 'rprashant264',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Change to true when using HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/shyam_polycom',
    ttl: 24 * 60 * 60,
    autoRemove: 'interval',
    autoRemoveInterval: 24 * 60,
  }),
};

// -------------------- MIDDLEWARE SETUP --------------------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session(sessionConfig));
app.use(flash());

// -------------------- PASSPORT CONFIGURATION --------------------
app.use(passport.initialize());
app.use(passport.session());
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// -------------------- GLOBAL VARIABLES --------------------
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// -------------------- ROUTES --------------------
app.use('/', indexRouter);

// -------------------- STATIC ASSETS --------------------
// Handle favicon and other common browser requests silently
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => res.status(204).end());
app.get('/apple-touch-icon.png', (req, res) => res.status(204).end());
app.get('/robots.txt', (req, res) => res.status(204).end());

// -------------------- DATABASE READY CHECK --------------------
app.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    console.warn('Database connection not ready. State:', mongoose.connection.readyState);
    return res.status(503).json({ error: 'Database connection not ready' });
  }
  next();
});

// -------------------- ERROR HANDLING --------------------
// Catch 404
app.use((req, res, next) => {
  next(createError(404));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error caught by error handler:', err);
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
