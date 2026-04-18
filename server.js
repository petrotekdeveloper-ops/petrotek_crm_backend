const dns = require('dns');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

require('dotenv').config();

// Windows: Node's DNS often fails mongodb+srv SRV lookups (querySrv ECONNREFUSED) while nslookup works.
// Optional override: MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1  |  set USE_PUBLIC_DNS_FOR_MONGODB=false to skip.
if (process.env.USE_PUBLIC_DNS_FOR_MONGODB !== 'false') {
  const servers = process.env.MONGODB_DNS_SERVERS
    ? process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['8.8.8.8', '1.1.1.1'];
  if (servers.length) dns.setServers(servers);
}

app.use(cors());
app.use(express.json());

const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const salesRoutes = require('./routes/sales');
const managerTeamRoutes = require('./routes/managerTeam');
const tripRoutes = require('./routes/trips');
const serviceRoutes = require('./routes/service');

app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/manager', managerTeamRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/service', serviceRoutes);

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