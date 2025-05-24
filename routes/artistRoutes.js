const express = require('express');
const { getArtistsByLocation } = require('../controllers/artistController');
const rateLimiter = require('../utils/rateLimiter');

const router = express.Router();

router.get('/by-location', rateLimiter, getArtistsByLocation);

module.exports = router;
