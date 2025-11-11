const mongoose = require('mongoose');

// Line item schema for products in a sale
const saleLineItemSchema = new mongoose.Schema({
    productRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    hsnCode: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    units: {
        type: Number,
        required: true,
        min: 1
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    amount: {
        type: Number,
        required: true
    }
}, { _id: false });

const saleSchema = new mongoose.Schema({
    saleId: {
        type: String,
        required: true,
        unique: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    customerName: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    lineItems: [saleLineItemSchema],
    totalAmount: {
        type: Number,
        required: true,
        default: 0
    },
    totalUnits: {
        type: Number,
        required: true,
        default: 0
    }
}, {
    timestamps: true
});

// Auto-generate sale ID before validation so required check passes
saleSchema.pre('validate', async function(next) {
    try {
        if (!this.saleId) {
            const lastSale = await this.constructor.findOne({}, {}, { sort: { 'saleId': -1 } });
            const lastNumber = lastSale ? parseInt(lastSale.saleId.substring(1)) : 0;
            this.saleId = `S${String(lastNumber + 1).padStart(3, '0')}`;
        }
        
        // Calculate total amount and units
        this.totalAmount = 0;
        this.totalUnits = 0;
        if (Array.isArray(this.lineItems)) {
            this.lineItems.forEach(item => {
                this.totalAmount += (item.amount || 0);
                this.totalUnits += (item.units || 0);
            });
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Validate stock availability for all products before save
saleSchema.pre('save', async function(next) {
    try {
        const Product = mongoose.model('Product');
        if (!Array.isArray(this.lineItems)) {
            return next(new Error('No line items in sale'));
        }
        
        for (const item of this.lineItems) {
            const product = await Product.findById(item.productRef);
            if (!product) {
                return next(new Error(`Product ${item.productName} not found`));
            }
            if (product.stock < item.units) {
                return next(new Error(`Insufficient stock for ${item.productName}. Available: ${product.stock}, Requested: ${item.units}`));
            }
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Update product stock for all items after sale
saleSchema.post('save', async function() {
    try {
        const Product = mongoose.model('Product');
        if (Array.isArray(this.lineItems)) {
            for (const item of this.lineItems) {
                await Product.findByIdAndUpdate(item.productRef, {
                    $inc: { stock: -item.units }
                });
            }
        }
    } catch (err) {
        console.error('Error updating stock after sale save:', err);
    }
});

// Revert stock update for all items after sale deletion
saleSchema.pre('remove', async function(next) {
    try {
        const Product = mongoose.model('Product');
        if (Array.isArray(this.lineItems)) {
            for (const item of this.lineItems) {
                await Product.findByIdAndUpdate(item.productRef, {
                    $inc: { stock: item.units }
                });
            }
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Revert stock update for all items after findByIdAndDelete
saleSchema.post('findByIdAndDelete', async function(doc) {
    try {
        if (doc && Array.isArray(doc.lineItems)) {
            const Product = mongoose.model('Product');
            for (const item of doc.lineItems) {
                await Product.findByIdAndUpdate(item.productRef, {
                    $inc: { stock: item.units }
                });
            }
        }
    } catch (err) {
        console.error('Error reverting stock after sale deletion:', err);
    }
});

module.exports = mongoose.model('Sale', saleSchema);
