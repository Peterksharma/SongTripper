
require('dotenv').config();

// Get the token from environment variables
const token = process.env.SPOTIFY_ACCESS_TOKEN;
console.log('This is the token:', token)

if(!token) {
    console.error('The token is missing')
    process.exit(1)
}

async function fetchWebApi(endpoint, method, body) {
  const res = await fetch(`https://api.spotify.com/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    method,
    body:JSON.stringify(body)
  });
  return await res.json();
}

async function getTopTracks(){
  // Endpoint reference : https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks
  return (await fetchWebApi(
    'v1/me/top/tracks?time_range=long_term&limit=5', 'GET'
  )).items;
}

// Create an async main function
async function main() {
  try {
    const topTracks = await getTopTracks();
    console.log(
      topTracks?.map(
        ({name, artists}) =>
          `${name} by ${artists.map(artist => artist.name).join(', ')}`
      )
    );
  } catch (error) {
    console.error('Error:', error);
  }
}

// Call the main function
main();

