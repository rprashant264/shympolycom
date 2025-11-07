require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();
var session = require("express-session");
const passport = require('passport');
const localStrategy = require('passport-local').Strategy;
const flash = require("connect-flash");

// NOTE: Database connection is established in the server startup (bin/www)
// to ensure the app only starts listening after MongoDB is ready.

// Session configuration
const sessionConfig = {
    name: 'session',
    resave: true, // Changed to true to ensure session is saved
    saveUninitialized: true, // Changed to true to ensure session is created
    secret: process.env.SESSION_SECRET || "rprashant264",
    cookie: {
        httpOnly: true,
        secure: false, // Set to false for development
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 24 * 7
    },
    store: MongoStore.create({
        client: mongoose.connection.getClient(),
        ttl: 24 * 60 * 60, // Session TTL (in seconds)
        touchAfter: 24 * 3600,
        crypto: {
            secret: process.env.SESSION_SECRET || 'rprashant264'
        },
        autoRemove: 'interval',
        autoRemoveInterval: 24 * 60
    })
};

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Initialize session before passport
app.use(session(sessionConfig));

// Initialize passport and restore authentication state from session
app.use(passport.initialize());
app.use(passport.session());

// Configure passport-local-mongoose
const User = require('./routes/users');
passport.use(User.createStrategy()); // Use createStrategy instead of new localStrategy
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Flash messages - should be after session
app.use(flash());

// Make current user available in templates
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.error = req.flash('error');
    res.locals.success = req.flash('success');
    next();
});
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection error handling middleware
app.use((req, res, next) => {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: 'Database connection is not ready'
        });
    }
    next();
});

// Rate limiting for API routes
if (process.env.NODE_ENV === 'production') {
    const rateLimit = require('express-rate-limit');
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // limit each IP to 100 requests per windowMs
    });
    app.use('/api', apiLimiter);
}

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
