const mongoose = require('mongoose');

async function connectDB() {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/polycom';
        
        const options = {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10,
            socketTimeoutMS: 45000
        };

        await mongoose.connect(uri, options);

        mongoose.connection.on('connected', () => {
            console.log('MongoDB connected successfully');
        });

        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB disconnected');
        });

        return mongoose.connection;
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        throw err;
    }
}

module.exports = { connectDB };