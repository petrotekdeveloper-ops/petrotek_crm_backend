const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

require('dotenv').config();

app.use(cors());
app.use(express.json());

const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const salesRoutes = require('./routes/sales');
const managerTeamRoutes = require('./routes/managerTeam');

app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/manager', managerTeamRoutes);

async function connectDB() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("MongoDB Connected");
    } catch (err) {
      console.log("Mongo Error:", err);
    }
  }
  
  connectDB();



const PORT = process.env.PORT;
app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
});