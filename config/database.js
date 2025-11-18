const mongoose = require('mongoose');

async function connectDB() {
    try {
        // Local MongoDB connection
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/shyam_polycom';
        const options = {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10,
            socketTimeoutMS: 45000
        };

        // Prevent multiple connections
        if (
            mongoose.connection.readyState === 1 || // connected
            mongoose.connection.readyState === 2    // connecting
        ) {
            return mongoose.connection;
        }

        await mongoose.connect(uri, options);

        mongoose.connection.on('connected', () => {
            console.log('✅ MongoDB connected successfully');
        });

        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('📴 MongoDB disconnected');
        });

        return mongoose.connection;
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        throw err;
    }
}

module.exports = { connectDB };
