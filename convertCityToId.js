// let cityName = 'Austin'
// console.log(cityName)

// // Using the MusicBrainz API to search for a city
// const searchCity = async (cityName) => {
//  const url = `https://musicbrainz.org/ws/2/place?query=${encodeURIComponent(cityName)}&fmt=json`;

  
//   const response = await fetch(url, {
//     headers: {
//       'User-Agent': 'YourAppName/1.0 (peterksharma@gmail.com)' // Include a proper User-Agent header
//     }
//   });
  
//   if (!response.ok) {
//     throw new Error(`Error: ${response.status}`);
//   }
  
//   const data = await response.json();
//   console.log(data)
//   return data;
// };

// searchCity(cityName)

let cityName = 'Austin'
console.log(cityName)

// Using the MusicBrainz API to search for a city and return its ID
const getCityId = async (cityName, state = null) => {
  const query = state ? `${cityName} ${state}` : cityName;
  const url = `https://musicbrainz.org/ws/2/place?query=${encodeURIComponent(query)}&fmt=json`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'YourAppName/1.0 (peterksharma@gmail.com)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Look for places in the response
    if (data.places && data.places.length > 0) {
      // Look for the city ID in the area field of places
      for (const place of data.places) {
        if (place.area && place.area.type === 'City' && 
            place.area.name.toLowerCase() === cityName.toLowerCase()) {
          const cityId = place.area.id;
          console.log(`City ID for ${cityName}: ${cityId}`);
          return cityId;
        }
      }
      
      // If no exact match, look for any area that's a city
      for (const place of data.places) {
        if (place.area && place.area.type === 'City') {
          console.log(`Found city area: ${place.area.name} (${place.area.id})`);
          const cityId = place.area.id;
          console.log(`Using city ID for ${place.area.name}: ${cityId}`);
          return cityId;
        }
      }
      
      // Show what we found for debugging
      console.log('Available places with areas:', data.places.slice(0, 5).map(p => ({
        name: p.name,
        type: p.type,
        area: p.area ? { name: p.area.name, type: p.area.type, id: p.area.id } : null
      })));
    }
    
    throw new Error(`No city found for: ${cityName}`);
    
  } catch (error) {
    console.error('Error searching for city:', error);
    throw error;
  }
};

// Example usage - search for Austin, Texas specifically
getCityId('Austin', 'Texas')
  .then(cityId => {
    console.log('Retrieved city ID:', cityId);
    
    // Now you can use this ID to search for artists
    const artistUrl = `https://musicbrainz.org/ws/2/artist?area=${cityId}&limit=50&fmt=json`;
    console.log('Artist search URL:', artistUrl);
  })
  .catch(error => {
    console.error('Failed to get city ID:', error);
  });

// Alternative function that returns both ID and city info
const getCityInfo = async (cityName, state = null) => {
  const query = state ? `${cityName} ${state}` : cityName;
  const url = `https://musicbrainz.org/ws/2/place?query=${encodeURIComponent(query)}&fmt=json`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'YourAppName/1.0 (peterksharma@gmail.com)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.places && data.places.length > 0) {
      // Look for the city ID in the area field of places
      for (const place of data.places) {
        if (place.area && place.area.type === 'City' && 
            place.area.name.toLowerCase() === cityName.toLowerCase()) {
          return {
            id: place.area.id,
            name: place.area.name,
            type: place.area.type
          };
        }
      }
      
      // If no exact match, return first city area found
      for (const place of data.places) {
        if (place.area && place.area.type === 'City') {
          return {
            id: place.area.id,
            name: place.area.name,
            type: place.area.type
          };
        }
      }
    }
    
    throw new Error(`No city found for: ${cityName}`);
    
  } catch (error) {
    console.error('Error searching for city:', error);
    throw error;
  }
};