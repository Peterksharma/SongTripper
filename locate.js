class Location {
    constructor() {
        this.latitude = latitude
        this.longitude = longitude

    }
}

const degreeChar = '°'
 
let latitude = '30|13|29.5|N'
let longitude = '97|42|16.8|W'

let theLocation = {
    latitude: {
        degrees: 0,
        minutes: 0,
        seconds: 0,
        direction: ''
    },
    longitude: {
        degrees: 0,
        minutes: 0,
        seconds: 0,
        direction: ''

    }
}


let theLatParts = []
let theLongParts = []

let i = 0 
while (i < 4 ) {
    let latPart = latitude.split('|')[i]
    let longPart = longitude.split('|')[i]
    theLatParts.push(latPart) 
    theLongParts.push(longPart)
    i++
}



let nSHemisphere = theLatParts.pop()
let eWHemisphere = theLongParts.pop()




theLocation.latitude.direction = nSHemisphere
theLocation.longitude.direction = eWHemisphere

console.log('Lat Hemisphere:', nSHemisphere)
console.log('Long Hemisphere:', eWHemisphere)

const mathSecond = 360/60
const mathMinute = mathSecond
console.log('A second or minute is:', mathSecond, degreeChar)


theLocation.latitude.degrees = latitude.split('|')[0]
theLocation.latitude.minutes = latitude.split('|')[1]
theLocation.latitude.seconds = latitude.split('|')[2]
theLocation.longitude.degrees = latitude.split('|')[0]
theLocation.longitude.minutes = latitude.split('|')[1]
theLocation.longitude.seconds = latitude.split('|')[2]


// console.log("latitudeMinutes", latitudeMinutes)
// console.log("latitudeSeconds", latitudeSeconds)
// console.log("latitudeSeconds", latitudeDirection)


theLocation.latitude.degrees = theLatParts[0]
console.log('Location Object: ', theLocation)


const myLocation = new Location(latitude, longitude)
console.log( myLocation)

//I know that I'm going to need to do a simliarity check here.
