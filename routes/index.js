var express = require('express');
var router = express.Router();
const mongoose = require('mongoose');
const userModel = require("./users");
const postModel = require("./posts");
const passport = require('passport');
const upload = require('./multer');

// Import all models
const Product = require('../models/product');
const Customer = require('../models/customer');
const Employee = require('../models/employee');
const Sale = require('../models/sale');
const Purchase = require('../models/purchase');
const Vendor = require('../models/vendor');


// Home Page (Public)
router.get('/', (req, res) => {
  res.render('index', { title: 'My App' });
});

// Dashboard / Home (Protected)
router.get('/home', isLoggedIn, async (req, res) => {
  try {
    console.log('Accessing /home route');
    console.log('Session:', req.session);
    console.log('User:', req.user);
    
    if (!req.session.passport || !req.session.passport.user) {
      console.log('No user in session, redirecting to login');
      return res.redirect('/login');
    }

    const user = await userModel
      .findOne({ username: req.session.passport.user })
      .populate('posts')
      .lean();
    
    if (!user) {
      console.log('User not found in database');
      req.logout(err => {
        if (err) console.error('Error during logout:', err);
        res.redirect('/login');
      });
      return;
    }

    console.log('User found:', user.username);
    // Prepare dashboard stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Top selling products (by units)
    const topProductsAgg = await Sale.aggregate([
      { $group: { _id: '$productRef', productName: { $first: '$productName' }, units: { $sum: '$units' }, amount: { $sum: '$amount' } } },
      { $sort: { units: -1 } },
      { $limit: 5 }
    ]);
const lowStockProducts = await Product.find({ stock: { $lt: 10 } })
  .sort({ stock: 1 })
  .limit(5)
  .lean();


    // Monthly totals
    const salesThisMonthAgg = await Sale.aggregate([
      { $match: { date: { $gte: startOfMonth } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, totalUnits: { $sum: '$units' } } }
    ]);
    const purchasesThisMonthAgg = await Purchase.aggregate([
      { $match: { date: { $gte: startOfMonth } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, totalUnits: { $sum: '$units' } } }
    ]);

    const salesThisMonth = (salesThisMonthAgg[0] && salesThisMonthAgg[0].totalAmount) || 0;
    const purchasesThisMonth = (purchasesThisMonthAgg[0] && purchasesThisMonthAgg[0].totalAmount) || 0;

    // Recent activity
    const recentSales = await Sale.find().sort({ date: -1 }).limit(5).lean();
    const recentPurchases = await Purchase.find().sort({ date: -1 }).limit(5).lean();

    const totalProducts = await Product.countDocuments();

    res.render('home', {
      user,
      dashboard: {
        topProducts: topProductsAgg,
        lowStock: lowStockProducts,
        salesThisMonth,
        purchasesThisMonth,
        recentSales,
        recentPurchases,
        totalProducts
      }
    });
  } catch (err) {
    console.error('Error preparing dashboard:', err);
    // fallback to original user render
    const user = await userModel.findOne({ username: req.session.passport.user }).populate('posts');
    res.render('home', { user });
  }
});

// Registration Page
router.get('/register', (req, res) => {
  res.render('register');
});

// Register User
router.post('/register', async (req, res) => {
  try {
    const existingUser = await userModel.findOne({ username: req.body.username });
    if (existingUser) {
      return res.status(400).send("Username already exists. Please choose a different one.");
    }

    const newUser = new userModel({
      username: req.body.username,
      secret: req.body.secret,
      name: req.body.fullname
    });

    await userModel.register(newUser, req.body.password);
    passport.authenticate("local")(req, res, () => res.redirect('/home'));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error during registration.");
  }
});

// Login Page
router.get('/login', (req, res) => {
  res.render('login', { error: req.flash('error') });
});

// Login Auth
router.post('/login', (req, res, next) => {
  console.log('Login attempt for username:', req.body.username);
  
  if (!req.body.username || !req.body.password) {
    console.log('Missing credentials');
    req.flash('error', 'Please enter both username and password');
    return res.redirect('/login');
  }

  passport.authenticate('local', (err, user, info) => {
    console.log('Inside passport.authenticate callback');
    console.log('Error:', err);
    console.log('User:', user);
    console.log('Info:', info);
    
    if (err) {
      console.error('Authentication error:', err);
      req.flash('error', 'An error occurred during authentication');
      return res.redirect('/login');
    }
    
    if (!user) {
      console.log('Login failed. Info:', info);
      req.flash('error', info.message || 'Invalid username or password');
      return res.redirect('/login');
    }

    req.logIn(user, (err) => {
      console.log('Inside req.logIn callback');
      if (err) {
        console.error('Login error:', err);
        req.flash('error', 'An error occurred during login');
        return res.redirect('/login');
      }

      console.log('Login successful for user:', user.username);
      console.log('Session ID:', req.sessionID);
      console.log('Session:', req.session);
      req.flash('success', 'Welcome back!');
      res.redirect('/home');
    });
  })(req, res, next);
});

// Logout
router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

// Inventory page: compute compiled inventory from Product, Purchase and Sale collections
router.get('/inventory', isLoggedIn, async (req, res, next) => {
  try {
    // aggregate total purchased units per product
    const purchasesAgg = await Purchase.aggregate([
      { $group: { _id: '$productRef', totalPurchased: { $sum: '$units' } } }
    ]);
    // aggregate total sold units per product
    const salesAgg = await Sale.aggregate([
      { $group: { _id: '$productRef', totalSold: { $sum: '$units' } } }
    ]);

    const purchaseMap = {};
    purchasesAgg.forEach(p => { if (p._id) purchaseMap[String(p._id)] = p.totalPurchased; });
    const saleMap = {};
    salesAgg.forEach(s => { if (s._id) saleMap[String(s._id)] = s.totalSold; });

    const products = await Product.find().sort({ productName: 1 }).lean();

    const items = products.map(p => {
      const id = String(p._id);
      const purchaseUnits = purchaseMap[id] || 0;
      const saleUnits = saleMap[id] || 0;
      const stock = (typeof p.stock === 'number') ? p.stock : Math.max(purchaseUnits - saleUnits, 0);
      const cost = Number(p.cost || 0);
      const stockAmount = Number((stock * cost) || 0);
      return {
        _id: p._id,
        hsnCode: p.hsnCode,
        productName: p.productName,
        cost,
        purchaseUnits,
        saleUnits,
        stock,
        stockAmount
      };
    });

    res.render('inventory', { items });
  } catch (err) {
    next(err);
  }
});





// Create new inventory item
router.post('/inventory', isLoggedIn, async (req, res, next) => {
  try {
    // Check if HSN code already exists
    const existingItem = await Item.findOne({ hsnCode: req.body.hsnCode });
    if (existingItem) {
      return res.status(400).json({ error: 'HSN Code already exists' });
    }

    const newItem = new Item({
      hsnCode: req.body.hsnCode,
      productName: req.body.productName,
      cost: req.body.cost,
      purchaseUnits: req.body.purchaseUnits,
      saleUnits: req.body.saleUnits,
      stock: req.body.stock
    });

    await newItem.save();
    res.status(201).json(newItem);
  } catch (err) {
    next(err);
  }
});

// Update inventory item
router.put('/inventory/:id', isLoggedIn, async (req, res, next) => {
  try {
    // If HSN code is being changed, check if new code already exists
    if (req.body.hsnCode) {
      const existingItem = await Item.findOne({ 
        hsnCode: req.body.hsnCode,
        _id: { $ne: req.params.id }
      });
      if (existingItem) {
        return res.status(400).json({ error: 'HSN Code already exists' });
      }
    }

    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          hsnCode: req.body.hsnCode,
          productName: req.body.productName,
          cost: req.body.cost,
          purchaseUnits: req.body.purchaseUnits,
          saleUnits: req.body.saleUnits,
          stock: req.body.stock
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(updatedItem);
  } catch (err) {
    next(err);
  }
});

// Delete inventory item
router.delete('/inventory/:id', isLoggedIn, async (req, res, next) => {
  try {
    const deletedItem = await Item.findByIdAndDelete(req.params.id);
    
    if (!deletedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Customers page
router.get('/customers', isLoggedIn, async (req, res, next) => {
  try {
    const customers = await Customer.find().sort({ name: 1 }).lean();
    res.render('customers', { customers });
  } catch (err) {
    next(err);
  }
});

// Create customer
router.post('/customers', isLoggedIn, async (req, res, next) => {
  try {
    // Basic validation
    const { name, email, phone, address } = req.body;
    if (!name || !email || !address) {
      return res.status(400).json({ error: 'Missing required fields: name, email, address' });
    }

    // Check duplicate email
    const existing = await Customer.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const newCustomer = new Customer({ name, email, phone, address });
    await newCustomer.save();
    res.status(201).json(newCustomer);
  } catch (err) {
    console.error('Error creating customer:', err);
    // Mongoose validation or other known errors -> 400
    if (err.name === 'ValidationError' || err.code === 11000) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Failed to create customer' });
  }
});

// Update customer
router.put('/customers/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address } = req.body;
    const updated = await Customer.findByIdAndUpdate(req.params.id, { name, email, phone, address }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Customer not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating customer:', err);
    if (err.name === 'ValidationError' || err.code === 11000) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to update customer' });
  }
});

// Delete customer
router.delete('/customers/:id', isLoggedIn, async (req, res, next) => {
  try {
    // prevent deleting customers linked to sales
    const hasSales = await Sale.exists({ customerId: req.params.id });
    if (hasSales) return res.status(400).json({ error: 'Cannot delete customer with sales' });
    const deleted = await Customer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Customer not found' });
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ error: err.message || 'Failed to delete customer' });
  }
});

// Employees page
router.get('/employees', isLoggedIn, async (req, res, next) => {
  try {
    const employees = await Employee.find().sort({ name: 1 }).lean();
    res.render('employees', { employees });
  } catch (err) {
    next(err);
  }
});

// Create employee
router.post('/employees', isLoggedIn, async (req, res, next) => {
  try {
    const newEmployee = new Employee({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      address: req.body.address,
      role: req.body.role || 'staff'
    });
    await newEmployee.save();
    res.status(201).json(newEmployee);
  } catch (err) {
    console.error('Error creating employee:', err);
    res.status(500).json({ error: err.message || 'Failed to create employee' });
  }
});

// Update employee
router.put('/employees/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address, role } = req.body;
    const updated = await Employee.findByIdAndUpdate(req.params.id, { name, email, phone, address, role }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Employee not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating employee:', err);
    if (err.name === 'ValidationError' || err.code === 11000) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to update employee' });
  }
});

// Delete employee
router.delete('/employees/:id', isLoggedIn, async (req, res, next) => {
  try {
    const deleted = await Employee.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ error: err.message || 'Failed to delete employee' });
  }
});

// Create purchase
router.post('/purchases', isLoggedIn, async (req, res, next) => {
  try {
    // Accept either productRef (id) or hsnCode to locate product
    // vendorId may be provided to link to a Vendor
    const { productRef, productId, hsnCode, units, cost, vendor, vendorId, date } = req.body;
    let product = null;
    if (productRef || productId) {
      const id = productRef || productId;
      product = await Product.findById(id);
    } else if (hsnCode) {
      product = await Product.findOne({ hsnCode });
    }

    if (!product) {
      return res.status(400).json({ error: 'Product not found for purchase' });
    }

    const unitsNum = Number(units || 0);
    const costNum = Number(cost || product.cost || 0);
    const amount = unitsNum * costNum;

    // resolve vendor if vendorId provided
    let vendorName = vendor || '';
    let vendorRef = vendorId || null;
    if (vendorRef) {
      try {
        const v = await Vendor.findById(vendorRef).lean();
        if (v) vendorName = v.name;
      } catch (e) {}
    }

    const purchase = new Purchase({
      hsnCode: product.hsnCode,
      productName: product.productName,
      vendor: vendorName || '',
      vendorRef: vendorRef || null,
      date: date ? new Date(date) : Date.now(),
      units: unitsNum,
      cost: costNum,
      amount,
      productRef: product._id
    });

    await purchase.save();
    // post-save hook on Purchase increments product stock; reload to return normalized object
    const saved = await Purchase.findById(purchase._id).populate('productRef').lean();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Error creating purchase:', err);
    res.status(500).json({ error: err.message || 'Failed to create purchase' });
  }
});

router.put('/purchases/:id', isLoggedIn, async (req, res) => {
  try {
    // Always get immutable baseline
    const oldPurchase = await Purchase.findById(req.params.id).lean();
    if (!oldPurchase) return res.status(404).json({ error: 'Purchase not found' });

    const oldUnits = Number(oldPurchase.units || 0);
    const oldProductId = oldPurchase.productRef ? String(oldPurchase.productRef) : null;

    // Parse new values
    const newUnits = Number(req.body.units);
    const newCost = Number(req.body.cost ?? oldPurchase.cost);
    if (isNaN(newUnits) || newUnits < 0) return res.status(400).json({ error: 'Invalid units value' });
    if (isNaN(newCost) || newCost < 0) return res.status(400).json({ error: 'Invalid cost value' });

    const amount = newUnits * newCost;

    // Determine product
    let productId = req.body.productRef || req.body.productId || oldProductId;
    if (!productId && req.body.hsnCode) {
      const product = await Product.findOne({ hsnCode: req.body.hsnCode }).lean();
      if (product) productId = String(product._id);
    }
    if (!productId) return res.status(400).json({ error: 'No product specified for purchase' });

    console.log('---- PURCHASE UPDATE ----');
    console.log({ oldUnits, newUnits, oldProductId, productId });

    // =========================
    // Stock logic
    // =========================
    if (String(productId) !== String(oldProductId)) {
      // product changed
      if (oldProductId) {
        await Product.findByIdAndUpdate(oldProductId, { $inc: { stock: -oldUnits } });
        console.log(`Reverted old product (${oldProductId}) by -${oldUnits}`);
      }
      await Product.findByIdAndUpdate(productId, { $inc: { stock: newUnits } });
      console.log(`Added to new product (${productId}) +${newUnits}`);
    } else {
      // same product
      const diff = newUnits - oldUnits;
      if (diff !== 0) {
        await Product.findByIdAndUpdate(productId, { $inc: { stock: diff } });
        console.log(`Adjusted product (${productId}) by ${diff}`);
      } else {
        console.log('No stock change');
      }
    }

    // =========================
    // Update purchase record
    // =========================
    const updatedData = {
      date: req.body.date ? new Date(req.body.date) : oldPurchase.date,
      units: newUnits,
      cost: newCost,
      amount,
    };

    // vendor handling
    if (req.body.vendorId) {
      const v = await Vendor.findById(req.body.vendorId).lean();
      if (v) {
        updatedData.vendor = v.name;
        updatedData.vendorRef = v._id;
      }
    } else if (req.body.vendor !== undefined) {
      updatedData.vendor = req.body.vendor;
      updatedData.vendorRef = null;
    }

    // product info refresh
    if (String(productId) !== String(oldProductId)) {
      const np = await Product.findById(productId).lean();
      if (np) {
        updatedData.productRef = np._id;
        updatedData.hsnCode = np.hsnCode;
        updatedData.productName = np.productName;
      }
    }

    const updatedPurchase = await Purchase.findByIdAndUpdate(req.params.id, updatedData, { new: true })
      .populate('productRef')
      .lean();

    console.log('---- UPDATE COMPLETE ----\n');
    res.json(updatedPurchase);
  } catch (err) {
    console.error('Error updating purchase:', err);
    res.status(500).json({ error: err.message || 'Failed to update purchase' });
  }
});





// Delete purchase
router.delete('/purchases/:id', isLoggedIn, async (req, res, next) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    // decrement product stock when a purchase is removed
    if (purchase.productRef) {
      await Product.findByIdAndUpdate(purchase.productRef, { $inc: { stock: -purchase.units } });
    }

    await Purchase.findByIdAndDelete(req.params.id);
    res.json({ message: 'Purchase deleted' });
  } catch (err) {
    console.error('Error deleting purchase:', err);
    res.status(500).json({ error: err.message || 'Failed to delete purchase' });
  }
});

// Create sale - now supports multiple products (lineItems)
router.post('/sales', isLoggedIn, async (req, res, next) => {
  try {
    const { customerId, date, lineItems } = req.body;
    
    // Validate inputs
    if (!customerId) return res.status(400).json({ error: 'Customer is required' });
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ error: 'At least one product is required' });
    }

    // Validate and enrich line items
    const enrichedLineItems = [];
    let totalAmount = 0;
    let totalUnits = 0;

    for (const item of lineItems) {
      const product = await Product.findById(item.productRef);
      if (!product) {
        return res.status(400).json({ error: `Product not found: ${item.productName}` });
      }
      if (product.stock < item.units) {
        return res.status(400).json({ error: `Insufficient stock for ${item.productName}. Available: ${product.stock}, Requested: ${item.units}` });
      }

      enrichedLineItems.push({
        productRef: product._id,
        hsnCode: product.hsnCode,
        productName: product.productName,
        units: Number(item.units),
        price: Number(item.price),
        amount: Number(item.units) * Number(item.price)
      });

      totalAmount += enrichedLineItems[enrichedLineItems.length - 1].amount;
      totalUnits += Number(item.units);
    }

    // Get customer name
    const customer = await Customer.findById(customerId).lean();
    if (!customer) return res.status(400).json({ error: 'Customer not found' });

    const sale = new Sale({
      customerId,
      customerName: customer.name,
      date: date ? new Date(date) : Date.now(),
      lineItems: enrichedLineItems,
      totalAmount,
      totalUnits
    });

    await sale.save();
    const saved = await Sale.findById(sale._id).populate('customerId').lean();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Error creating sale:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Failed to create sale' });
  }
});

// Update sale (multi-product version, transaction-safe)
router.put('/sales/:id', isLoggedIn, async (req, res) => {
  let session;
  try {
    const saleId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(saleId)) {
      return res.status(400).json({ error: 'Invalid sale id' });
    }

    session = await mongoose.startSession();
    let resultSale = null;

    // ---------------- TRANSACTION PATH ----------------
    try {
      await session.withTransaction(async () => {
        const sale = await Sale.findById(saleId).session(session);
        if (!sale) {
          const err = new Error('Sale not found'); err.status = 404; throw err;
        }

        const oldLineItems = Array.isArray(sale.lineItems) ? sale.lineItems : [];
        const newLineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];

        // STEP 1: Revert old stock
        await Promise.all(oldLineItems.map(item =>
          Product.findByIdAndUpdate(item.productRef, { $inc: { stock: Number(item.units) } }).session(session)
        ));

        // STEP 2: Validate and enrich new line items
        const enrichedItems = [];
        let totalUnits = 0;
        let totalAmount = 0;

        for (const item of newLineItems) {
          if (!mongoose.Types.ObjectId.isValid(item.productRef)) {
            const err = new Error('Invalid product reference'); err.status = 400; throw err;
          }

          const product = await Product.findById(item.productRef).session(session);
          if (!product) {
            const err = new Error(`Product not found: ${item.productRef}`); err.status = 400; throw err;
          }

          const units = Number(item.units);
          const price = Number(item.price);
          if (!Number.isFinite(units) || units <= 0 || !Number.isInteger(units)) {
            const err = new Error(`Invalid units for ${product.productName}`); err.status = 400; throw err;
          }
          if (!Number.isFinite(price) || price < 0) {
            const err = new Error(`Invalid price for ${product.productName}`); err.status = 400; throw err;
          }

          if (product.stock < units) {
            const err = new Error(`Insufficient stock for ${product.productName}. Available: ${product.stock}, Requested: ${units}`);
            err.status = 400; throw err;
          }

          const amount = units * price;
          enrichedItems.push({
            productRef: product._id,
            hsnCode: product.hsnCode,
            productName: product.productName,
            units,
            price,
            amount
          });

          totalUnits += units;
          totalAmount += amount;
        }

        // STEP 3: Customer validation
        let custRef = req.body.customerId || sale.customerId;
        if (custRef && !mongoose.Types.ObjectId.isValid(String(custRef))) {
          const err = new Error('Invalid customer id'); err.status = 400; throw err;
        }

        let custName = sale.customerName;
        if (custRef) {
          const c = await Customer.findById(custRef).session(session);
          if (c) custName = c.name;
        }

        // STEP 4: Update sale document
        const newDate = req.body.date ? new Date(req.body.date) : sale.date;
        if (isNaN(newDate.getTime())) {
          const err = new Error('Invalid date'); err.status = 400; throw err;
        }

        await Sale.findByIdAndUpdate(
          sale._id,
          {
            customerId: custRef,
            customerName: custName,
            date: newDate,
            lineItems: enrichedItems,
            totalUnits,
            totalAmount
          },
          { new: true, runValidators: true, session }
        );

        // STEP 5: Deduct new stock
        await Promise.all(enrichedItems.map(item =>
          Product.findByIdAndUpdate(item.productRef, { $inc: { stock: -Number(item.units) } }).session(session)
        ));

        // STEP 6: Load updated sale for response
        resultSale = await Sale.findById(sale._id)
          .populate('customerId')
          .populate('lineItems.productRef')
          .session(session)
          .lean();
      });

      session.endSession();
      return res.json(resultSale);

    } catch (txErr) {
      // ---------------- NON-TRANSACTIONAL FALLBACK ----------------
      const msg = String(txErr && txErr.message || '').toLowerCase();
      if (!/replica set|transaction numbers are only allowed|not a replica set/.test(msg)) throw txErr;

      try { session.endSession(); } catch (e) {}

      const sale = await Sale.findById(saleId);
      if (!sale) return res.status(404).json({ error: 'Sale not found' });

      const oldLineItems = Array.isArray(sale.lineItems) ? sale.lineItems : [];
      const newLineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];

      // Revert old stock
      await Promise.all(oldLineItems.map(item =>
        Product.findByIdAndUpdate(item.productRef, { $inc: { stock: Number(item.units) } })
      ));

      // Validate new items
      const enrichedItems = [];
      let totalUnits = 0;
      let totalAmount = 0;

      for (const item of newLineItems) {
        const product = await Product.findById(item.productRef);
        if (!product) return res.status(400).json({ error: `Product not found: ${item.productRef}` });
        const units = Number(item.units);
        const price = Number(item.price);
        if (!Number.isFinite(units) || units <= 0 || !Number.isInteger(units))
          return res.status(400).json({ error: `Invalid units for ${product.productName}` });
        if (!Number.isFinite(price) || price < 0)
          return res.status(400).json({ error: `Invalid price for ${product.productName}` });
        if (product.stock < units)
          return res.status(400).json({ error: `Insufficient stock for ${product.productName}` });

        enrichedItems.push({
          productRef: product._id,
          hsnCode: product.hsnCode,
          productName: product.productName,
          units,
          price,
          amount: units * price
        });

        totalUnits += units;
        totalAmount += units * price;
      }

      // Deduct stock for new items
      await Promise.all(enrichedItems.map(item =>
        Product.findByIdAndUpdate(item.productRef, { $inc: { stock: -Number(item.units) } })
      ));

      // Update sale
      const updatedSale = await Sale.findByIdAndUpdate(
        sale._id,
        {
          customerId: req.body.customerId || sale.customerId,
          customerName: req.body.customerName || sale.customerName,
          date: req.body.date ? new Date(req.body.date) : sale.date,
          lineItems: enrichedItems,
          totalUnits,
          totalAmount
        },
        { new: true, runValidators: true }
      )
        .populate('customerId')
        .populate('lineItems.productRef')
        .lean();

      return res.json(updatedSale);
    }

  } catch (err) {
    if (session) try { await session.abortTransaction(); session.endSession(); } catch (e) {}
    console.error('Error updating sale:', err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: err.message || 'Failed to update sale' });
  }
});
// Delete sale
router.delete('/sales/:id', isLoggedIn, async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    // Restore stock for all line items
    if (Array.isArray(sale.lineItems)) {
      for (const item of sale.lineItems) {
        await Product.findByIdAndUpdate(item.productRef, { $inc: { stock: item.units } });
      }
    }

    await Sale.findByIdAndDelete(req.params.id);
    res.json({ message: 'Sale deleted' });
  } catch (err) {
    console.error('Error deleting sale:', err);
    res.status(500).json({ error: err.message || 'Failed to delete sale' });
  }
});

// Feed page
router.get('/feed', isLoggedIn, async (req, res, next) => {
  try {
    const posts = await postModel.find({})
      .populate('author')
      .sort({ createdAt: -1 })
      .lean();
    res.render('feed', { posts });
  } catch (err) {
    next(err);
  }
});

// Products routes
router.get('/products', isLoggedIn, async (req, res, next) => {
  try {
    const products = await Product.find()
      .sort({ productName: 1 })
      .lean();
    res.render('products', { products });
  } catch (err) {
    next(err);
  }
});

// API: list products (JSON)
router.get('/api/products', isLoggedIn, async (req, res, next) => {
  try {
    const products = await Product.find().sort({ productName: 1 }).lean();
    res.json(products);
  } catch (err) {
    next(err);
  }
});

// API: list customers (JSON)
router.get('/api/customers', isLoggedIn, async (req, res, next) => {
  try {
    const customers = await Customer.find().sort({ name: 1 }).lean();
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

// API: list vendors (JSON). Optional filter by productId to get vendors that supply a product
router.get('/api/vendors', isLoggedIn, async (req, res, next) => {
  try {
    const { productId } = req.query;
    let q = {};
    if (productId) q.products = productId;
    const vendors = await Vendor.find(q).sort({ name: 1 }).lean();
    res.json(vendors);
  } catch (err) {
    next(err);
  }
});

// Create new product
router.post('/products', isLoggedIn, async (req, res, next) => {
  try {
    const existingProduct = await Product.findOne({ hsnCode: req.body.hsnCode });
    if (existingProduct) {
      return res.status(400).json({ error: 'HSN Code already exists' });
    }

    const newProduct = new Product({
      hsnCode: req.body.hsnCode,
      productName: req.body.productName,
      cost: req.body.cost,
      sellingPrice: req.body.sellingPrice,
      stock: req.body.stock || 0
    });

    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (err) {
    next(err);
  }
});

// Vendors page
router.get('/vendors', isLoggedIn, async (req, res, next) => {
  try {
    const vendors = await Vendor.find().sort({ name: 1 }).lean();
    res.render('vendors', { vendors });
  } catch (err) {
    next(err);
  }
});

// Create vendor
router.post('/vendors', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address, products } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    // Handle products array - ensure we get valid ObjectIds
    const prodArray = Array.isArray(products) ? products : (products ? [products] : []);
    const v = new Vendor({ name, email, phone, address, products: prodArray.filter(p => mongoose.Types.ObjectId.isValid(p)) });
    await v.save();
    res.status(201).json(v);
  } catch (err) {
    console.error('Error creating vendor:', err);
    if (err.name === 'ValidationError' || err.code === 11000) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to create vendor' });
  }
});

// Update vendor
router.put('/vendors/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address, products } = req.body;
    // Handle products array - ensure we get valid ObjectIds
    const prodArray = Array.isArray(products) ? products : (products ? [products] : []);
    const validProducts = prodArray.filter(p => mongoose.Types.ObjectId.isValid(p));
    const updated = await Vendor.findByIdAndUpdate(req.params.id, { name, email, phone, address, products: validProducts }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Vendor not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating vendor:', err);
    res.status(500).json({ error: err.message || 'Failed to update vendor' });
  }
});

// Delete vendor
router.delete('/vendors/:id', isLoggedIn, async (req, res, next) => {
  try {
    // optionally, prevent delete if used in purchases
    const hasPurchases = await Purchase.exists({ vendorRef: req.params.id });
    if (hasPurchases) return res.status(400).json({ error: 'Cannot delete vendor with associated purchases' });
    const deleted = await Vendor.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ message: 'Vendor deleted' });
  } catch (err) {
    console.error('Error deleting vendor:', err);
    res.status(500).json({ error: err.message || 'Failed to delete vendor' });
  }
});

// Update product
router.put('/products/:id', isLoggedIn, async (req, res, next) => {
  try {
    if (req.body.hsnCode) {
      const existingProduct = await Product.findOne({
        hsnCode: req.body.hsnCode,
        _id: { $ne: req.params.id }
      });
      if (existingProduct) {
        return res.status(400).json({ error: 'HSN Code already exists' });
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(updatedProduct);
  } catch (err) {
    next(err);
  }
});

// Delete product
router.delete('/products/:id', isLoggedIn, async (req, res, next) => {
  try {
    // Check if product is referenced in purchases or sales
    const hasPurchases = await Purchase.exists({ productRef: req.params.id });
    const hasSales = await Sale.exists({ productRef: req.params.id });

    if (hasPurchases || hasSales) {
      return res.status(400).json({ 
        error: 'Cannot delete product with associated purchases or sales' 
      });
    }

    const deletedProduct = await Product.findByIdAndDelete(req.params.id);
    if (!deletedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Profile page
router.get('/profile', isLoggedIn, async (req, res, next) => {
  try {
    const user = await userModel
      .findOne({ username: req.session.passport.user })
      .populate('posts')
      .lean();
    res.render('profile', { user });
  } catch (err) {
    next(err);
  }
});

// Purchases page
router.get('/purchases', isLoggedIn, async (req, res, next) => {
  try {
    const purchases = await Purchase.find()
      .populate('productRef')
      .sort({ createdAt: -1 })
      .lean();
    // normalize for template
    const normalized = purchases.map(p => ({
      _id: p._id,
      productRef: p.productRef && p.productRef._id,
      hsnCode: p.hsnCode || (p.productRef && p.productRef.hsnCode),
      productName: p.productName || (p.productRef && p.productRef.productName),
      vendor: p.vendor,
      vendorRef: p.vendorRef ? (p.vendorRef._id || p.vendorRef) : '',
      date: p.date ? p.date.toISOString().slice(0,10) : '',
      units: p.units,
      cost: p.cost,
      amount: p.amount
    }));
    res.render('purchases', { purchases: normalized });
  } catch (err) {
    next(err);
  }
});

// GET all sales
router.get('/sales', isLoggedIn, async (req, res, next) => {
  try {
    const sales = await Sale.find()
      .populate({
        path: 'lineItems.productRef',        // ✅ nested populate
        select: 'productName hsnCode stock price'
      })
      .populate({
        path: 'customerId',                  // ✅ populate customer
        select: 'custId name'
      })
      .sort({ createdAt: -1 })
      .lean();

    // Normalize data for frontend
    const normalized = sales.map(sale => {
      const items = (sale.lineItems || []).map(item => ({
        productRef: item.productRef?._id || item.productRef,
        hsnCode: item.hsnCode || item.productRef?.hsnCode || '',
        productName: item.productName || item.productRef?.productName || '',
        stockUnits: item.productRef?.stock || 0,
        units: item.units || 0,
        price: item.price || 0,
        amount: item.amount || 0
      }));

      return {
        _id: sale._id,
        saleId: sale.saleId || '',
        customerId: sale.customerId?.custId || '',
        customerDbId: sale.customerId?._id || '',
        customerName: sale.customerName || sale.customerId?.name || '',
        date: sale.date ? new Date(sale.date).toISOString().slice(0, 10) : '',
        totalAmount: sale.totalAmount || 0,
        totalUnits: sale.totalUnits || 0,
        lineItems: items
      };
    });

    res.render('sales', { sales: normalized });
  } catch (err) {
    console.error('Error fetching sales:', err);
    next(err);
  }
});



// Auth middleware
  // Salary page
  router.get('/salary', isLoggedIn, async (req, res, next) => {
    try {
      const vendors = await Vendor.find().sort({ name: 1 }).lean();
      res.render('salary', { vendors });
    } catch (err) {
      next(err);
    }
  });

  // API: Calculate vendor payment for date range
  router.post('/api/salary/calculate', isLoggedIn, async (req, res, next) => {
    try {
      const { vendorId, startDate, endDate } = req.body;

      // Validate inputs
      if (!vendorId || !startDate || !endDate) {
        return res.status(400).json({ error: 'Missing vendorId, startDate, or endDate' });
      }

      // Validate vendor exists
      const vendor = await Vendor.findById(vendorId).lean();
      if (!vendor) {
        return res.status(404).json({ error: 'Vendor not found' });
      }

      // Parse dates
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      // Set end date to end of day
      end.setHours(23, 59, 59, 999);

      // Fetch purchases for this vendor within date range
      const purchases = await Purchase.find({
        vendorRef: vendorId,
        date: { $gte: start, $lte: end }
      }).populate('productRef').lean();

      // Calculate total amount
      const totalAmount = purchases.reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalUnits = purchases.reduce((sum, p) => sum + (p.units || 0), 0);

      res.json({
        vendorId,
        vendorName: vendor.name,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        purchases,
        totalUnits,
        totalAmount,
        purchaseCount: purchases.length
      });
    } catch (err) {
      console.error('Error calculating salary:', err);
      res.status(500).json({ error: err.message || 'Failed to calculate payment' });
    }
  });

  // API: Generate professional PDF salary slip for vendor for the date range
  router.post('/api/salary/pdf', isLoggedIn, async (req, res, next) => {
    try {
      const { vendorId, startDate, endDate } = req.body;
      if (!vendorId || !startDate || !endDate) return res.status(400).json({ error: 'Missing vendorId, startDate or endDate' });

      const vendor = await Vendor.findById(vendorId).lean();
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23,59,59,999);

      const purchases = await Purchase.find({ vendorRef: vendorId, date: { $gte: start, $lte: end } }).populate('productRef').lean();

      // Totals
      const totalAmount = purchases.reduce((s, p) => s + (p.amount || 0), 0);
      const totalUnits = purchases.reduce((s, p) => s + (p.units || 0), 0);

      // Create PDF document and stream to response
      res.setHeader('Content-Type', 'application/pdf');
      const filenameSafe = (vendor.name || 'vendor').replace(/[^a-z0-9\-\_]/gi, '_');
      res.setHeader('Content-Disposition', `attachment; filename="vendor-payment-${filenameSafe}-${start.toISOString().slice(0,10)}-to-${end.toISOString().slice(0,10)}.pdf"`);

      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      doc.pipe(res);

      // Header
      doc.fontSize(16).font('Helvetica-Bold').text('Shyam Polycom', { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(12).font('Helvetica').text('Vendor Payment Slip', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#444').text(`Vendor: ${vendor.name}    Period: ${start.toISOString().slice(0,10)} to ${end.toISOString().slice(0,10)}`, { align: 'center' });
      doc.moveDown(1);

      // Summary boxes
      const summaryTop = doc.y;
      const boxWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 3 - 6;
      const startX = doc.x;

      doc.rect(startX, summaryTop, boxWidth, 48).stroke();
      doc.fontSize(10).font('Helvetica-Bold').text('Total Amount', startX + 6, summaryTop + 6);
      doc.fontSize(12).font('Helvetica').text(`₹ ${totalAmount.toFixed(2)}`, startX + 6, summaryTop + 24);

      doc.rect(startX + boxWidth + 6, summaryTop, boxWidth, 48).stroke();
      doc.fontSize(10).font('Helvetica-Bold').text('Total Units', startX + boxWidth + 12, summaryTop + 6);
      doc.fontSize(12).font('Helvetica').text(`${totalUnits}`, startX + boxWidth + 12, summaryTop + 24);

      doc.rect(startX + (boxWidth + 6) * 2, summaryTop, boxWidth, 48).stroke();
      doc.fontSize(10).font('Helvetica-Bold').text('Purchase Count', startX + (boxWidth + 6) * 2 + 6, summaryTop + 6);
      doc.fontSize(12).font('Helvetica').text(`${purchases.length}`, startX + (boxWidth + 6) * 2 + 6, summaryTop + 24);

      doc.moveDown(4);

      // Table header
      const tableTop = doc.y;
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Date', 36, tableTop, { width: 70 });
      doc.text('HSN', 110, tableTop, { width: 70 });
      doc.text('Product', 180, tableTop, { width: 160 });
      doc.text('Units', 350, tableTop, { width: 60, align: 'right' });
      doc.text('Cost', 420, tableTop, { width: 70, align: 'right' });
      doc.text('Amount', 495, tableTop, { width: 70, align: 'right' });
      doc.moveTo(36, doc.y + 14).lineTo(doc.page.width - 36, doc.y + 14).stroke();
      doc.moveDown(1.2);

      // Table rows
      doc.font('Helvetica').fontSize(9);
      purchases.forEach(p => {
        const y = doc.y;
        const date = p.date ? new Date(p.date).toISOString().slice(0,10) : '';
        doc.text(date, 36, y, { width: 70 });
        doc.text(p.hsnCode || '', 110, y, { width: 70 });
        const productName = p.productName || (p.productRef && p.productRef.productName) || '';
        doc.text(productName, 180, y, { width: 160 });
        doc.text(String(p.units || 0), 350, y, { width: 60, align: 'right' });
        doc.text((p.cost != null ? Number(p.cost) : 0).toFixed(2), 420, y, { width: 70, align: 'right' });
        doc.text((p.amount != null ? Number(p.amount) : 0).toFixed(2), 495, y, { width: 70, align: 'right' });
        doc.moveDown(1);
        // Add page break handling
        if (doc.y > doc.page.height - 72) doc.addPage();
      });

      // Totals
      doc.moveDown(1);
      doc.fontSize(10).font('Helvetica-Bold').text('Totals', 36, doc.y);
      doc.fontSize(10).font('Helvetica').text(`Total Units: ${totalUnits}`, 36, doc.y + 16);
      doc.fontSize(12).font('Helvetica-Bold').text(`Total Amount: ₹ ${totalAmount.toFixed(2)}`, { align: 'right' });

      // Signature area
      doc.moveDown(6);
      const sigY = doc.y;
      doc.text('Prepared By', 36, sigY);
      doc.text('__________________', 36, sigY + 36);
      doc.text('Authorized Signatory', doc.page.width - 220, sigY);
      doc.text('__________________', doc.page.width - 220, sigY + 36);

      doc.end();
    } catch (err) {
      console.error('Error generating PDF:', err);
      res.status(500).json({ error: err.message || 'Failed to generate PDF' });
    }
  });

// Auth middleware
function isLoggedIn(req, res, next) {
  console.log('=== isLoggedIn Middleware ===');
  console.log('Auth check - isAuthenticated:', req.isAuthenticated());
  console.log('Session ID:', req.sessionID);
  console.log('Session:', req.session);
  console.log('User:', req.user);
  console.log('Cookies:', req.cookies);
  console.log('=========================');

  if (req.isAuthenticated()) {
    console.log('User is authenticated, proceeding to next middleware');
    return next();
  }
  
  console.log('User is not authenticated, redirecting to login');
  // Store the requested URL for redirection after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

module.exports = router;
