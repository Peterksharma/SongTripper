const express = require('express');
const { lookupCity } = require('../controllers/cityController');

const router = express.Router();

router.get('/lookup', lookupCity);

module.exports = router;
