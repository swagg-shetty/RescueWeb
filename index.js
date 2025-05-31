const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const mysql = require('mysql2');
const app = express();
const port = 3000;

// Create database connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',        
    password: '$Urjith2005',        
    database: 'disaster_assistace',  
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const db = pool.promise();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'your_secret_key',  
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false, 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Routes for HTML files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'loginpage.html')));
app.get('/requesthelp', (req, res) => res.sendFile(path.join(__dirname, 'requesthelp.html')));
app.get('/checkstatus', (req, res) => res.sendFile(path.join(__dirname, 'checkstatus.html')));
app.get('/volunteer', (req, res) => res.sendFile(path.join(__dirname, 'volunteer.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'about.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/reliefcenters', (req, res) => res.sendFile(path.join(__dirname, 'reliefcenters.html')));

// Test DB connection
app.get('/test-db', async (req, res) => {
    try {
        const [results] = await db.query('SELECT 1 + 1 AS result');
        res.send(`DB is working! Result: ${results[0].result}`);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('DB connection failed');
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { usernameOrEmail, password } = req.body;

    if (!usernameOrEmail || !password) {
        return res.status(400).send('Username/email and password are required');
    }

    try {
        const [results] = await db.query(
            'SELECT * FROM users WHERE email = ? OR username = ?',
            [usernameOrEmail, usernameOrEmail]
        );

        if (results.length === 0) {
            return res.status(401).send('Invalid username/email or password');
        }

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).send('Invalid username/email or password');
        }

        // Set user session (using user_id)
        req.session.user = {
            user_id: user.user_id,
            name: user.fname,
            email: user.email,
            username: user.username
        };

        res.redirect('/');
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('Internal server error');
    }
});

// Signup endpoint
app.post('/signup', async (req, res) => {
    const { fullName, signupEmail, signupPassword } = req.body;

    if (!fullName || !signupEmail || !signupPassword) {
        return res.status(400).send('All fields are required.');
    }

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [signupEmail]);

        if (rows.length > 0) {
            return res.status(409).send('User already exists with this email.');
        }

        const username = signupEmail.split('@')[0];
        const [usernameCheck] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        const finalUsername = usernameCheck.length > 0 ? `${username}${Math.floor(Math.random() * 1000)}` : username;
        const hashedPassword = await bcrypt.hash(signupPassword, 10);

        await db.query(
            'INSERT INTO users (fname, email, username, password) VALUES (?, ?, ?, ?)',
            [fullName, signupEmail, finalUsername, hashedPassword]
        );

        res.status(201).send('User registered successfully.');
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).send('Error during signup. Please try again.');
    }
});

// Submit request endpoint (single instance)
app.post('/submit-request', async (req, res) => {
    const { email, victimName, resourceId, quantity, priority, location, notes } = req.body;

    if (!email || !victimName || !resourceId || !quantity || !priority) {
        return res.status(400).json({ error: 'All required fields must be filled' });
    }

    try {
        const [userRows] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);

        if (userRows.length === 0) {
            return res.status(404).json({ error: 'Email not found in our database' });
        }

        const userId = userRows[0].user_id;

        await db.query(
            'INSERT INTO requests (user_id, victim_name, resource_id, quantity, priority, location, additional_notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, victimName, resourceId, quantity, priority.toUpperCase(), location, notes]
        );

        res.status(201).json({ message: 'Request submitted successfully' });
    } catch (error) {
        console.error('Error submitting request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get requests by email (single instance)
app.get('/get-requests', async (req, res) => {
    const email = req.query.email;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const [results] = await db.query(`
            SELECT r.request_id, r.victim_name, rt.resource_name, r.quantity, r.priority, 
                   r.location, r.additional_notes, r.requested_date, r.status, rt.resource_id
            FROM requests r
            JOIN users u ON r.user_id = u.user_id
            JOIN resourcetype rt ON r.resource_id = rt.resource_id
            WHERE u.email = ?
            ORDER BY r.requested_date DESC
        `, [email]);

        res.json(results);
    } catch (error) {
        console.error('Error fetching requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get single request details
app.get('/get-request/:id', async (req, res) => {
    const requestId = req.params.id;

    try {
        const [results] = await db.query(`
            SELECT r.request_id, r.victim_name, rt.resource_name, r.quantity, r.priority, 
                   r.location, r.additional_notes, r.requested_date, r.status, u.email, rt.resource_id
            FROM requests r
            JOIN users u ON r.user_id = u.user_id
            JOIN resourcetype rt ON r.resource_id = rt.resource_id
            WHERE r.request_id = ?
        `, [requestId]);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json(results[0]);
    } catch (error) {
        console.error('Error fetching request details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update request
app.put('/update-request/:id', async (req, res) => {
    const requestId = req.params.id;
    const { email, victimName, resourceId, quantity, priority, location, notes } = req.body;

    if (!email || !victimName || !resourceId || !quantity || !priority) {
        return res.status(400).json({ error: 'All required fields must be filled' });
    }

    try {
        const [userRows] = await db.query(`
            SELECT u.user_id 
            FROM users u
            JOIN requests r ON u.user_id = r.user_id
            WHERE u.email = ? AND r.request_id = ?
        `, [email, requestId]);

        if (userRows.length === 0) {
            return res.status(403).json({ error: 'Not authorized to edit this request' });
        }

        await db.query(`
            UPDATE requests 
            SET victim_name = ?, resource_id = ?, quantity = ?, priority = ?, 
                location = ?, additional_notes = ? 
            WHERE request_id = ?
        `, [victimName, resourceId, quantity, priority.toUpperCase(), location, notes, requestId]);

        res.json({ message: 'Request updated successfully' });
    } catch (error) {
        console.error('Error updating request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete request
app.delete('/delete-request/:id', async (req, res) => {
    const requestId = req.params.id;
    const email = req.query.email;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const [userRows] = await db.query(`
            SELECT u.user_id 
            FROM users u
            JOIN requests r ON u.user_id = r.user_id
            WHERE u.email = ? AND r.request_id = ?
        `, [email, requestId]);

        if (userRows.length === 0) {
            return res.status(403).json({ error: 'Not authorized to delete this request' });
        }

        await db.query('DELETE FROM requests WHERE request_id = ?', [requestId]);
        res.json({ message: 'Request deleted successfully' });
    } catch (error) {
        console.error('Error deleting request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Password reset endpoint
app.post('/reset-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).send('Email is required');
    }

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

        if (rows.length === 0) {
            return res.status(200).send('If your email exists in our database, you will receive a password reset link');
        }

        res.status(200).send('Password reset link sent to your email');
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).send('Error processing password reset request');
    }
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('Error logging out');
        }
        res.redirect('/login');
    });
});

//volunteer.html

// Serve static files from the public directory
app.use(express.static('public'));

// Check if user exists endpoint
app.get('/users/check', async (req, res) => {
    const email = req.query.email;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const [rows] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
        if (rows.length > 0) {
            res.json({ user_id: rows[0].user_id });
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Error checking user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Organizations API endpoints - with better error handling and debugging
app.post('/organizations', async (req, res) => {
    console.log('Received organization data:', req.body);
    
    const { 
        organization_name, 
        organization_type, 
        contact_person, 
        cp_email, 
        cp_phone, 
        address, 
        website, 
        organization_description 
    } = req.body;

    // Check each required field individually
    const missingFields = [];
    if (!organization_name) missingFields.push('organization_name');
    if (!organization_type) missingFields.push('organization_type');
    if (!contact_person) missingFields.push('contact_person');
    if (!cp_email) missingFields.push('cp_email');
    if (!cp_phone) missingFields.push('cp_phone');
    if (!address) missingFields.push('address');
    
    if (missingFields.length > 0) {
        console.log('Missing fields:', missingFields);
        return res.status(400).json({ 
            error: `Missing required fields: ${missingFields.join(', ')}`,
            missingFields 
        });
    }

    try {
        const [result] = await db.query(
            'INSERT INTO organizations (organization_name, organization_type, contact_person, cp_email, cp_phone, address, website, organization_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [organization_name, organization_type, contact_person, cp_email, cp_phone, address, website || '', organization_description || '']
        );

        console.log('Organization inserted successfully:', result.insertId);
        
        res.status(201).json({ 
            message: 'Organization registered successfully',
            organization_id: result.insertId
        });
    } catch (error) {
        console.error('Error registering organization:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ error: 'This organization already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }
});

// Donations API endpoints
app.post('/donations', async (req, res) => {
    const { 
        donar_name, 
        donar_email, 
        donar_phone, 
        donar_organization_name, 
        resource_id, 
        donation_type, 
        donation_amount, 
        donation_type_qty, 
        description, 
        status 
    } = req.body;

    // Validate required fields
    if (!donar_name || !donation_type) {
        return res.status(400).json({ error: 'All required fields must be filled' });
    }

    try {
        const [result] = await db.query(
            'INSERT INTO donations (donar_name, donar_email, donar_phone, donar_organization_name, resource_id, donation_type, donation_amount, donation_type_qty, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [donar_name, donar_email, donar_phone, donar_organization_name, resource_id, donation_type, donation_amount, donation_type_qty, description, status]
        );

        res.status(201).json({ 
            message: 'Donation submitted successfully',
            donation_id: result.insertId
        });
    } catch (error) {
        console.error('Error submitting donation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Volunteer API endpoints
app.post('/volunteers', async (req, res) => {
    const { 
        user_id, 
        vol_org, 
        skills, 
        availability, 
        vol_area, 
        status, 
        emg_name, 
        emg_number 
    } = req.body;

    // Validate required fields
    if (!user_id || !skills || !availability || !status || !emg_name || !emg_number) {
        return res.status(400).json({ error: 'All required fields must be filled' });
    }

    try {
        // Check if user exists
        const [userCheck] = await db.query('SELECT user_id FROM users WHERE user_id = ?', [user_id]);
        if (userCheck.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const [result] = await db.query(
            'INSERT INTO volunteer (user_id, vol_org, skills, availability, vol_area, status, emg_name, emg_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [user_id, vol_org, skills, availability, vol_area, status, emg_name, emg_number]
        );

        res.status(201).json({ 
            message: 'Volunteer registered successfully',
            volunteer_id: result.insertId
        });
    } catch (error) {
        console.error('Error registering volunteer:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get volunteers by user ID
app.get('/volunteers/user/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        const [results] = await db.query(`
            SELECT v.*
            FROM volunteer v
            WHERE v.user_id = ?
        `, [userId]);

        res.json(results);
    } catch (error) {
        console.error('Error fetching volunteers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update volunteer status
app.put('/volunteers/:id', async (req, res) => {
    const volunteerId = req.params.id;
    const { availability, status } = req.body;

    if (!availability || !status) {
        return res.status(400).json({ error: 'Availability and status are required' });
    }

    try {
        await db.query(
            'UPDATE volunteer SET availability = ?, status = ? WHERE volunteer_id = ?',
            [availability, status, volunteerId]
        );

        res.json({ message: 'Volunteer record updated successfully' });
    } catch (error) {
        console.error('Error updating volunteer:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete volunteer
app.delete('/volunteers/:id', async (req, res) => {
    const volunteerId = req.params.id;

    try {
        await db.query('DELETE FROM volunteer WHERE volunteer_id = ?', [volunteerId]);
        res.json({ message: 'Volunteer record deleted successfully' });
    } catch (error) {
        console.error('Error deleting volunteer:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Vehicle API endpoints
// Vehicle API endpoints
app.post('/vehicles', async (req, res) => {
    console.log('Received vehicle data:', req.body);
    
    const { 
        user_id, 
        vehicle_type, 
        registration_number, 
        capacity, 
        veh_org_id, 
        current_location, 
        veh_status, 
        vehicle_specifications, 
        driver_name, 
        driver_contact 
    } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!user_id) missingFields.push('user_id');
    if (!vehicle_type) missingFields.push('vehicle_type');
    if (!registration_number) missingFields.push('registration_number');
    if (!capacity) missingFields.push('capacity');
    if (!veh_status) missingFields.push('veh_status');
    
    if (missingFields.length > 0) {
        console.log('Missing fields:', missingFields);
        return res.status(400).json({ 
            error: 'All required fields must be filled',
            missingFields
        });
    }

    try {
        // Check if user exists
        const [userCheck] = await db.query('SELECT user_id FROM users WHERE user_id = ?', [user_id]);
        if (userCheck.length === 0) {
            console.log(`User not found: ${user_id}`);
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if registration number is already in use
        const [regCheck] = await db.query('SELECT vehicle_id FROM vehicles WHERE registration_number = ?', [registration_number]);
        if (regCheck.length > 0) {
            console.log(`Registration number already in use: ${registration_number}`);
            return res.status(409).json({ error: 'Vehicle registration number already in use' });
        }

        // Insert vehicle record - setting veh_org_id to NULL if not provided
        const [result] = await db.query(
            'INSERT INTO vehicles (user_id, vehicle_type, registration_number, capacity, veh_org_id, current_location, veh_status, vehicle_specifications, driver_name, driver_contact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                user_id, 
                vehicle_type, 
                registration_number, 
                capacity, 
                veh_org_id || null, 
                current_location || '', 
                veh_status, 
                vehicle_specifications || '', 
                driver_name || '', 
                driver_contact || ''
            ]
        );

        console.log('Vehicle inserted successfully:', result.insertId);

        res.status(201).json({ 
            message: 'Vehicle registered successfully',
            vehicle_id: result.insertId
        });
    } catch (error) {
        console.error('Error registering vehicle:', error);
        
        let errorMessage = 'Internal server error';
        let statusCode = 500;
        
        // Handle specific database errors
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            errorMessage = 'Referenced organization does not exist';
            statusCode = 400;
        } else if (error.code === 'ER_DUP_ENTRY') {
            errorMessage = 'This vehicle is already registered';
            statusCode = 409;
        }
        
        res.status(statusCode).json({ 
            error: errorMessage,
            details: error.message
        });
    }
});

// Get vehicles by user ID
app.get('/vehicles/user/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        const [results] = await db.query(`
            SELECT v.*, o.organization_name
            FROM vehicles v
            LEFT JOIN organizations o ON v.veh_org_id = o.organization_id
            WHERE v.user_id = ?
        `, [userId]);

        res.json(results);
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});


// Update vehicle status
app.put('/vehicles/:id', async (req, res) => {
    const vehicleId = req.params.id;
    const { veh_status } = req.body;

    if (!veh_status) {
        return res.status(400).json({ error: 'Status is required' });
    }

    try {
        // Check if vehicle exists
        const [vehicleCheck] = await db.query('SELECT vehicle_id FROM vehicles WHERE vehicle_id = ?', [vehicleId]);
        if (vehicleCheck.length === 0) {
            return res.status(404).json({ error: 'Vehicle not found' });
        }

        await db.query(
            'UPDATE vehicles SET veh_status = ? WHERE vehicle_id = ?',
            [veh_status, vehicleId]
        );

        res.json({ message: 'Vehicle record updated successfully' });
    } catch (error) {
        console.error('Error updating vehicle:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Delete vehicle
app.delete('/vehicles/:id', async (req, res) => {
    const vehicleId = req.params.id;

    try {
        // Check if vehicle exists
        const [vehicleCheck] = await db.query('SELECT vehicle_id FROM vehicles WHERE vehicle_id = ?', [vehicleId]);
        if (vehicleCheck.length === 0) {
            return res.status(404).json({ error: 'Vehicle not found' });
        }

        await db.query('DELETE FROM vehicles WHERE vehicle_id = ?', [vehicleId]);
        res.json({ message: 'Vehicle record deleted successfully' });
    } catch (error) {
        console.error('Error deleting vehicle:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = app;

// Check if user is authenticated
app.get('/check-auth', (req, res) => {
    if (req.session.user) {
        return res.json({ loggedIn: true });
    }
    return res.json({ loggedIn: false });
});

// Middleware to handle .html requests
app.use((req, res, next) => {
    if (req.path.endsWith('.html')) {
        const newPath = req.path.replace('.html', '');
        return res.redirect(newPath);
    }
    next();
});

// Relief Center nnRoutes
// Fetch hospitals
app.get('/hospitals', async (req, res) => {
    try {
        const [results] = await db.query(`
            SELECT name, capacity, current_occupancy, contact_person, phone, location
            FROM Hospitals
        `);
        res.json(results);
    } catch (error) {
        console.error('Error fetching hospitals:', error);
        res.status(500).json({ error: 'Failed to fetch hospitals' });
    }
});

// Fetch shelters
app.get('/shelters', async (req, res) => {
    try {
        const [results] = await db.query(`
            SELECT name, capacity, current_occupancy, contact_person, phone, address
            FROM Shelters
        `);
        res.json(results);
    } catch (error) {
        console.error('Error fetching shelters:', error);
        res.status(500).json({ error: 'Failed to fetch shelters' });
    }
});

// Fetch resources
app.get('/resources', async (req, res) => {
    try {
        const [results] = await db.query(`
            SELECT r.id, rt.resource_name, r.quantity, r.unit, r.expiry_date, r.location
            FROM Resources r
            JOIN resourcetype rt ON r.resource_id = rt.resource_id
        `);
        res.json(results);
    } catch (error) {
        console.error('Error fetching resources:', error);
        res.status(500).json({ error: 'Failed to fetch resources' });
    }
});

// Hospital registration endpoint
app.post('/hospitals', async (req, res) => {
    const { name, capacity, current_occupancy, contact_person, phone, email, location } = req.body;

    try {
        await db.query(
            'INSERT INTO Hospitals (name, capacity, current_occupancy, contact_person, phone, email, location) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, capacity, current_occupancy, contact_person, phone, email, location]
        );
        res.redirect('/reliefcenters?success=true');
    } catch (error) {
        console.error('Error adding hospital:', error);
        res.redirect('/reliefcenters?error=Error%20adding%20hospital');
    }
});

// Add this route to handle both /reliefcenters and /reliefcenters.html
app.get('/reliefcenters', (req, res) => {
    // Check if the request is for .html
    if (req.path.endsWith('.html')) {
        return res.redirect('/reliefcenters');
    }
    res.sendFile(path.join(__dirname, 'reliefcenters.html'));
});

// Shelter registration endpoint
app.post('/shelters', async (req, res) => {
    const { name, capacity, current_occupancy, contact_person, phone, email, address } = req.body;

    try {
        await db.query(
            'INSERT INTO Shelters (name, capacity, current_occupancy, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, capacity, current_occupancy, contact_person, phone, email, address]
        );
        res.redirect('/reliefcenters?success=true');
    } catch (error) {
        console.error('Error adding shelter:', error);
        res.redirect('/reliefcenters?error=Error%20adding%20shelter');
    }
});

// Resource registration endpoint
app.post('/resources', async (req, res) => {
    const { resource_id, quantity, unit, expiry_date, location } = req.body;

    try {
        await db.query(
            'INSERT INTO Resources (resource_id, quantity, unit, expiry_date, location) VALUES (?, ?, ?, ?, ?)',
            [resource_id, quantity, unit, expiry_date, location]
        );
        res.redirect('/reliefcenters?success=true');
    } catch (error) {
        console.error('Error adding resource:', error);
        res.redirect('/reliefcenters?error=Error%20adding%20resource');
    }
});

// Dashboard statistics
app.get('/dashboard/stats', async (req, res) => {
    try {
        // Get total users count
        const [usersCount] = await db.query('SELECT COUNT(*) as count FROM users');
        
        // Get total resources count
        const [resourcesCount] = await db.query('SELECT COUNT(*) as count FROM resources');
        
        // Get pending requests count
        const [requestsCount] = await db.query('SELECT COUNT(*) as count FROM requests WHERE status = "Pending"');
        
        // Get active volunteers count
        const [volunteersCount] = await db.query('SELECT COUNT(*) as count FROM volunteer WHERE status = "Active"');
        
        // Get total donation amount (only when type is MONEY)
        const [donationsAmount] = await db.query('SELECT SUM(donation_amount) as total FROM donations WHERE donation_type = "MONEY"');
        
        // Get total vehicles count
        const [vehiclesCount] = await db.query('SELECT COUNT(*) as count FROM vehicles WHERE veh_status = "available"');
        
        res.json({
            totalUsers: usersCount[0].count,
            totalResources: resourcesCount[0].count,
            totalRequests: requestsCount[0].count,
            totalVolunteers: volunteersCount[0].count,
            totalDonations: donationsAmount[0].total || 0,
            totalVehicles: vehiclesCount[0].count
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Recent activities for dashboard
app.get('/dashboard/recent-activities', async (req, res) => {
    try {
        // Get recent requests
        const [requests] = await db.query(`
            SELECT 
                'New resource request' as activity,
                u.fname as user,
                rt.resource_name as type,
                r.requested_date as time,
                r.status
            FROM requests r
            JOIN users u ON r.user_id = u.user_id
            JOIN resourcetype rt ON r.resource_id = rt.resource_id
            ORDER BY r.requested_date DESC
            LIMIT 5
        `);
        
        // Format the results for the dashboard
        const activities = requests.map(req => ({
            activity: req.activity,
            user: req.user,
            type: req.type,
            time: formatDateTime(req.time),
            status: req.status
        }));
        
        res.json(activities);
    } catch (error) {
        console.error('Error fetching recent activities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all users for dashboard
app.get('/dashboard/users', async (req, res) => {
    try {
        const [users] = await db.query('SELECT user_id, fname, email, username FROM users');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all requests with resource names for dashboard
app.get('/dashboard/requests', async (req, res) => {
    try {
        const [requests] = await db.query(`
            SELECT r.request_id, r.victim_name, rt.resource_name, r.quantity, r.priority, 
                   r.location, r.additional_notes, r.requested_date, r.status, rt.resource_id
            FROM requests r
            JOIN resourcetype rt ON r.resource_id = rt.resource_id
            ORDER BY r.requested_date DESC
        `);
        res.json(requests);
    } catch (error) {
        console.error('Error fetching requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all resources with resource names for dashboard
app.get('/dashboard/resources', async (req, res) => {
    try {
        const [resources] = await db.query(`
            SELECT r.id, rt.resource_name, r.quantity, r.unit, r.location, r.expiry_date
            FROM resources r
            JOIN resourcetype rt ON r.resource_id = rt.resource_id
        `);
        res.json(resources);
    } catch (error) {
        console.error('Error fetching resources:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all donations for dashboard
app.get('/dashboard/donations', async (req, res) => {
    try {
        const [donations] = await db.query(`
            SELECT d.donation_id, d.donar_name, d.donar_email, d.donar_organization_name, 
                   d.donation_type, d.donation_amount, d.donation_type_qty, d.description, d.status
            FROM donations d
        `);
        res.json(donations);
    } catch (error) {
        console.error('Error fetching donations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all volunteers with user names for dashboard
app.get('/dashboard/volunteers', async (req, res) => {
    try {
        const [volunteers] = await db.query(`
            SELECT v.volunteer_id, u.fname as user_name, v.vol_org, v.skills, v.availability, 
                   v.vol_area, v.status, v.emg_name, v.emg_number
            FROM volunteer v
            JOIN users u ON v.user_id = u.user_id
        `);
        res.json(volunteers);
    } catch (error) {
        console.error('Error fetching volunteers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all vehicles for dashboard
app.get('/dashboard/vehicles', async (req, res) => {
    try {
        const [vehicles] = await db.query(`
            SELECT v.vehicle_id, v.vehicle_type, v.registration_number, v.capacity, 
                   o.organization_name, v.current_location, v.veh_status, v.driver_name, v.driver_contact
            FROM vehicles v
            LEFT JOIN organizations o ON v.veh_org_id = o.organization_id
        `);
        res.json(vehicles);
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all organizations for dashboard
app.get('/dashboard/organizations', async (req, res) => {
    try {
        const [organizations] = await db.query(`
            SELECT organization_id, organization_name, organization_type, contact_person, 
                   cp_email, cp_phone, address, website
            FROM organizations
        `);
        res.json(organizations);
    } catch (error) {
        console.error('Error fetching organizations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all hospitals for dashboard
app.get('/dashboard/hospitals', async (req, res) => {
    try {
        const [hospitals] = await db.query(`
            SELECT hospital_id, name, capacity, current_occupancy, contact_person, 
                   phone, email, location
            FROM hospitals
        `);
        res.json(hospitals);
    } catch (error) {
        console.error('Error fetching hospitals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all shelters for dashboard
app.get('/dashboard/shelters', async (req, res) => {
    try {
        const [shelters] = await db.query(`
            SELECT shelter_id, name, capacity, current_occupancy, contact_person, 
                   phone, email, address
            FROM shelters
        `);
        res.json(shelters);
    } catch (error) {
        console.error('Error fetching shelters:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get resource types for form options
app.get('/resource-types', async (req, res) => {
    try {
        const [resourceTypes] = await db.query('SELECT resource_id, resource_name FROM resourcetype');
        res.json(resourceTypes);
    } catch (error) {
        console.error('Error fetching resource types:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper function to format date time
function formatDateTime(date) {
    const d = new Date(date);
    const now = new Date();
    
    // Check if it's today
    if (d.toDateString() === now.toDateString()) {
        return `Today, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Check if it's yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
        return `Yesterday, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Otherwise return the date and time
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

// Get single entity by ID
app.get('/dashboard/:entityType/:id', async (req, res) => {
    const { entityType, id } = req.params;
    
    try {
        let query = '';
        switch(entityType) {
            case 'users':
                query = 'SELECT * FROM users WHERE user_id = ?';
                break;
            case 'requests':
                query = `
                    SELECT r.*, rt.resource_name
                    FROM requests r
                    JOIN resourcetype rt ON r.resource_id = rt.resource_id
                    WHERE r.request_id = ?
                `;
                break;
            case 'resources':
                query = `
                    SELECT r.*, rt.resource_name
                    FROM resources r
                    JOIN resourcetype rt ON r.resource_id = rt.resource_id
                    WHERE r.id = ?
                `;
                break;
            case 'donations':
                query = 'SELECT * FROM donations WHERE donation_id = ?';
                break;
            case 'volunteers':
                query = `
                    SELECT v.*, u.fname as user_name
                    FROM volunteer v
                    JOIN users u ON v.user_id = u.user_id
                    WHERE v.volunteer_id = ?
                `;
                break;
            case 'vehicles':
                query = `
                    SELECT v.*, o.organization_name
                    FROM vehicles v
                    LEFT JOIN organizations o ON v.veh_org_id = o.organization_id
                    WHERE v.vehicle_id = ?
                `;
                break;
            case 'organizations':
                query = 'SELECT * FROM organizations WHERE organization_id = ?';
                break;
            case 'hospitals':
                query = 'SELECT * FROM hospitals WHERE hospital_id = ?';
                break;
            case 'shelters':
                query = 'SELECT * FROM shelters WHERE shelter_id = ?';
                break;
            default:
                return res.status(400).json({ error: 'Invalid entity type' });
        }
        
        const [results] = await db.query(query, [id]);
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'Entity not found' });
        }
        
        res.json(results[0]);
    } catch (error) {
        console.error(`Error fetching ${entityType} details:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update entity by ID
app.put('/dashboard/:entityType/:id', async (req, res) => {
    const { entityType, id } = req.params;
    const updateData = req.body;
    
    try {
        let query = '';
        let params = [];
        
        switch(entityType) {
            case 'resources':
                query = 'UPDATE resources SET quantity = ?, unit = ?, location = ?, expiry_date = ? WHERE id = ?';
                params = [updateData.quantity, updateData.unit, updateData.location, updateData.expiry_date, id];
                break;
                
            case 'requests':
                query = `
                    UPDATE requests 
                    SET victim_name = ?, quantity = ?, priority = ?, status = ?, 
                        location = ?, additional_notes = ? 
                    WHERE request_id = ?
                `;
                params = [
                    updateData.victim_name, updateData.quantity, updateData.priority, 
                    updateData.status, updateData.location, updateData.additional_notes, id
                ];
                break;
                
            case 'vehicles':
                query = `
                    UPDATE vehicles 
                    SET vehicle_type = ?, registration_number = ?, capacity = ?, 
                        current_location = ?, veh_status = ?, driver_name = ?, driver_contact = ? 
                    WHERE vehicle_id = ?
                `;
                params = [
                    updateData.vehicle_type, updateData.registration_number, updateData.capacity,
                    updateData.current_location, updateData.veh_status, updateData.driver_name,
                    updateData.driver_contact, id
                ];
                break;
                
            case 'volunteers':
                query = `
                    UPDATE volunteer 
                    SET vol_org = ?, skills = ?, availability = ?, vol_area = ?, 
                        status = ?, emg_name = ?, emg_number = ? 
                    WHERE volunteer_id = ?
                `;
                params = [
                    updateData.vol_org, updateData.skills, updateData.availability,
                    updateData.vol_area, updateData.status, updateData.emg_name,
                    updateData.emg_number, id
                ];
                break;
                
            case 'hospitals':
                query = `
                    UPDATE hospitals 
                    SET name = ?, capacity = ?, current_occupancy = ?, 
                        contact_person = ?, phone = ?, email = ?, location = ? 
                    WHERE hospital_id = ?
                `;
                params = [
                    updateData.name, updateData.capacity, updateData.current_occupancy,
                    updateData.contact_person, updateData.phone, updateData.email,
                    updateData.location, id
                ];
                break;
                
            case 'organizations':
                query = `
                    UPDATE organizations 
                    SET organization_name = ?, organization_type = ?, contact_person = ?, 
                        cp_email = ?, cp_phone = ?, address = ?, website = ? 
                    WHERE organization_id = ?
                `;
                params = [
                    updateData.organization_name, updateData.organization_type, updateData.contact_person,
                    updateData.cp_email, updateData.cp_phone, updateData.address,
                    updateData.website, id
                ];
                break;
                
            case 'shelters':
                query = `
                    UPDATE shelters 
                    SET name = ?, capacity = ?, current_occupancy = ?, 
                        contact_person = ?, phone = ?, email = ?, address = ? 
                    WHERE shelter_id = ?
                `;
                params = [
                    updateData.name, updateData.capacity, updateData.current_occupancy,
                    updateData.contact_person, updateData.phone, updateData.email,
                    updateData.address, id
                ];
                break;
                
            // More cases can be added for other entity types
                
            default:
                return res.status(400).json({ error: 'Update not implemented for this entity type' });
        }
        
        await db.query(query, params);
        res.json({ message: `${entityType.slice(0, -1)} updated successfully` });
    } catch (error) {
        console.error(`Error updating ${entityType}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete entity by ID
app.delete('/dashboard/:entityType/:id', async (req, res) => {
    const { entityType, id } = req.params;
    
    try {
        let query = '';
        
        switch(entityType) {
            case 'users':
                query = 'DELETE FROM users WHERE user_id = ?';
                break;
            case 'requests':
                query = 'DELETE FROM requests WHERE request_id = ?';
                break;
            case 'resources':
                query = 'DELETE FROM resources WHERE id = ?';
                break;
            case 'donations':
                query = 'DELETE FROM donations WHERE donation_id = ?';
                break;
            case 'volunteers':
                query = 'DELETE FROM volunteer WHERE volunteer_id = ?';
                break;
            case 'vehicles':
                query = 'DELETE FROM vehicles WHERE vehicle_id = ?';
                break;
            case 'organizations':
                query = 'DELETE FROM organizations WHERE organization_id = ?';
                break;
            case 'hospitals':
                query = 'DELETE FROM hospitals WHERE hospital_id = ?';
                break;
            case 'shelters':
                query = 'DELETE FROM shelters WHERE shelter_id = ?';
                break;
            default:
                return res.status(400).json({ error: 'Invalid entity type' });
        }
        
        await db.query(query, [id]);
        res.json({ message: `${entityType.slice(0, -1)} deleted successfully` });
    } catch (error) {
        console.error(`Error deleting ${entityType}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new entity
app.post('/dashboard/:entityType', async (req, res) => {
    const { entityType } = req.params;
    const entityData = req.body;
    
    try {
        let query = '';
        let params = [];
        
        switch(entityType) {
            case 'resources':
                query = 'INSERT INTO resources (resource_id, quantity, unit, location, expiry_date) VALUES (?, ?, ?, ?, ?)';
                params = [
                    entityData.resource_id,
                    entityData.quantity,
                    entityData.unit,
                    entityData.location,
                    entityData.expiry_date || null
                ];
                break;
                
            // Add more cases for other entity types
                
            default:
                return res.status(400).json({ error: 'Create not implemented for this entity type' });
        }
        
        const [result] = await db.query(query, params);
        res.status(201).json({ 
            message: `${entityType.slice(0, -1)} created successfully`,
            id: result.insertId
        });
    } catch (error) {
        console.error(`Error creating ${entityType}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

