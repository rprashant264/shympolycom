const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['purchase', 'sale']
    },
    items: [{
        item: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        price: {
            type: Number,
            required: true
        }
    }],
    total: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'completed', 'cancelled'],
        default: 'pending'
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() { return this.type === 'sale'; }
    },
    supplier: {
        type: String,
        required: function() { return this.type === 'purchase'; }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Order', orderSchema);