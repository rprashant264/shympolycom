const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
    hsnCode: {
        type: String,
        required: true,
        unique: true
    },
    productName: {
        type: String,
        required: true
    },
    cost: {
        type: Number,
        required: true
    },
    purchaseUnits: {  // P Units
        type: String,
        required: true
    },
    saleUnits: {      // S Units
        type: String,
        required: true
    },
    stock: {
        type: Number,
        required: true,
        default: 0
    },
    stockAmount: {     // Stock Amt.
        type: Number,
        required: true,
        default: function() {
            return this.cost * this.stock;
        }
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

module.exports = mongoose.model('Item', itemSchema);