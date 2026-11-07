const express = require('express');
const { getSongsByLocation } = require('../controllers/songController');
const rateLimiter = require('../utils/rateLimiter');

const router = express.Router();

router.get('/by-location', rateLimiter, getSongsByLocation);

module.exports = router;
