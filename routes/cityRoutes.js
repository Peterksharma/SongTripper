const express = require('express');
const { lookupCity } = require('../controllers/cityController');
const rateLimiter = require('../utils/rateLimiter');

const router = express.Router();

router.get('/lookup', rateLimiter, lookupCity);

module.exports = router;
