const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
    empId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    phone: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: true,
        default: 'staff'
    }
}, {
    timestamps: true
});

// Auto-generate employee ID before validation so required check passes
employeeSchema.pre('validate', async function(next) {
    try {
        if (!this.empId) {
            const lastEmployee = await this.constructor.findOne({}, {}, { sort: { 'empId': -1 } });
            const lastNumber = lastEmployee ? parseInt(lastEmployee.empId.substring(1)) : 0;
            this.empId = `E${String(lastNumber + 1).padStart(3, '0')}`;
        }
        next();
    } catch (err) {
        next(err);
    }
});

module.exports = mongoose.model('Employee', employeeSchema);