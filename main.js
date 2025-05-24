require('dotenv').config();


const { convertGpsToCity } = require("./convertLocationToCity")

//
convertGpsToCity(30.2249, -97.7045)
    .then(data => {
        console.log('GPS coversion worked')
        console.log('The returned data')
        const theZip = data.results[0]
        console.log('This is the current Zipcode: ', theZip)
    }) .catch(e => {
        console.log('There was an error with the call ', e)
    })


