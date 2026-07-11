require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const complaintRoutes = require('./routes/complaints');
const noticeRoutes = require('./routes/notices');
const dashboardRoutes = require('./routes/dashboard');
const { uploadDir } = require('./middleware/upload');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded complaint photos
app.use('/uploads', express.static(uploadDir));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Multer / generic error handler (keeps error shape consistent for the frontend)
app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    return res.status(err.status || 400).json({ error: err.message || 'Something went wrong' });
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Society Maintenance Tracker API running on port ${PORT}`);
});
