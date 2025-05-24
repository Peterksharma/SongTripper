// const { getLocationData } = require("./locate")


// let theCity = getLocationData.city
// console.log(theCity)
require('dotenv').config();
const email = process.env.EMAIL;
console.log(email)

const city = 'Austin'
async function getArtists(city) {
  try {
    // Make the API request to MusicBrainz
    const response = await fetch(
      "https://musicbrainz.org/ws/2/artist?area=58d2816b-daf9-4fc5-962c-06967f14a5e5&limit=50&fmt=json",
      {
        headers: {
          "User-Agent": `Roadtripper/1.0.0 (${email})`,
          "Accept": "application/json"
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
     
    const data = await response.json();
    
    // Extract just the artist names
    const artistNames = data.artists.map(artist => artist.name);
    // console.log(artistNames)
    const randomArtist = artistNames[Math.floor(Math.random()*artistNames.length)]
    console.log('Random Artist from the target city: ', randomArtist)
    // Print the artist names
    // console.log("Artists from Austin:");
    // artistNames.forEach((name, index) => {
    //   console.log(`${index + 1}. ${name}`);
    // });
    
    // Return the names if you want to use them elsewhere
    return artistNames;
  } catch (error) {
    console.error("Error fetching Austin artists:", error);
    return [];
  }
}

// Call the function
getArtists();