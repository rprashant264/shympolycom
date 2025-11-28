const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    hsnCode: {
        type: String,
        required: true,
        unique: true
    },
    productName: {
        type: String,
        required: true
    },
    productWeight: {
        type: Number,
        required: function() {
            return this.category !== 'Other disposables';
        }
    },
    category: {
        type: String,
        enum: ['Glass', 'MS Casting', 'Other disposables'],
        default: 'Glass',
        required: true
    },
    cost: {
        type: Number,
        required: true
    },
    sellingPrice: {
        type: Number,
        required: true
    },
    stock: {
        type: Number,
        default: 0
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

module.exports = mongoose.model('Product', productSchema);
