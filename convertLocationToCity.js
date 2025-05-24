
// Get the token from environment variables
const locationToken = process.env.LOCATION_KEY;

const convertGpsToCity = async (latitude, longitude) => {
    try {
        const locationConvertionURL = `https://api.opencagedata.com/geocode/v1/json?q=${latitude}+${longitude}&key=${locationToken}`
        const response = await fetch(locationConvertionURL)
        const data =  await response.json()
        return data
        } catch (e) {
        console.error('Error with the fetch call', e)
    }
}


module.exports = { convertGpsToCity }
