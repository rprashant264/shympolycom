const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './public/images/uploads'); // Set upload directory
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

// Initialize Multer
const upload = multer({ storage });

module.exports = upload;
