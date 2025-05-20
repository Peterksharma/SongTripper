class Location {
    constructor() {
        this.latitude = latitude
        this.longitude = longitude

    }
}

const degreeChar = '°'
 
let latitude = '30|13|29.5|N'
let longitude = '97|42|16.8|W'

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
console.log('Lat Hemisphere:', nSHemisphere)
console.log('Long Hemisphere:', eWHemisphere)

const mathSecond = 360/60
const mathMinute = mathSecond
console.log('A second or minute is:', mathSecond, degreeChar)


console.log(theLatParts)
console.log(theLongParts)

// let latitudeDegrees = latitude.split('|')[0]
// let latitudeMinutes = latitude.split('|')[1]
// let latitudeSeconds = latitude.split('|')[2]
// let latitudeDirection = latitude.split('|')[3]

// console.log("latitudeDegrees", latitudeDegrees)
// console.log("latitudeMinutes", latitudeMinutes)
// console.log("latitudeSeconds", latitudeSeconds)
// console.log("latitudeSeconds", latitudeDirection)



const myLocation = new Location(latitude, longitude)
console.log( myLocation)

//I know that I'm going to need to do a simliarity check here.

