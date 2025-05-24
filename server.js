require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cityRoutes = require('./routes/cityRoutes');
const artistRoutes = require('./routes/artistRoutes');
const errorHandler = require('./utils/errorHandler');
const spotifyAuthRoutes = require('./routes/spotifyAuthRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Roadtripper API is running!' });
});

// TODO: Add city and artist routes here
app.use('/api/cities', cityRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/spotify', spotifyAuthRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


