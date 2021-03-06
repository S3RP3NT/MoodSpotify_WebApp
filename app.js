// Requiring packages needed

const SpotifyWebApi = require('spotify-web-api-node');
const express = require('express')
const {
    spawn
} = require('child_process');
const {
    totalmem
} = require('os');
require('dotenv').config();
const path = require('path');
const app = express()

// Scopes define the permissions the user needs to provide the app
const scopes = [
    'ugc-image-upload',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'streaming',
    'app-remote-control',
    'user-read-email',
    'user-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-read-private',
    'playlist-modify-private',
    'user-library-modify',
    'user-library-read',
    'user-top-read',
    'user-read-playback-position',
    'user-read-recently-played',
    'user-follow-read',
    'user-follow-modify'
];

// Instantiating the SpotifyWebApi object using constructor
const spotifyApi = new SpotifyWebApi({
    redirectUri: 'http://localhost:8888/callback',
    clientId: process.env.client_id,
    clientSecret: process.env.client_secret,
});

var moods = ''

// Setting view engine of expres app to ejs
app.set('view engine', 'ejs');
// Setting the default views folder
app.set('views', path.join(__dirname, 'views'));
// Serving static files of public folder
app.use(express.static('public'));
app.use(express.urlencoded({
    extended: false
}));
app.use(express.json());

// Home route
app.get('/', (req, res) => {
    res.render('home');
})

// Login route which then redirects to the authentication page
app.get('/login', (req, res) => {
    res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

// The default redirect route specified in the dashboard of Spotify Web API on successful authentication
app.get('/callback', (req, res) => {
    const error = req.query.error;
    const code = req.query.code;
    const state = req.query.state;

    if (error) {
        console.error('Callback Error:', error);
        res.send(`Callback Error: ${error}`);
        return;
    }

    spotifyApi
        .authorizationCodeGrant(code)
        .then(data => {
            const access_token = data.body['access_token'];
            const refresh_token = data.body['refresh_token'];
            const expires_in = data.body['expires_in'];

            spotifyApi.setAccessToken(access_token);
            spotifyApi.setRefreshToken(refresh_token);

            console.log('access_token:', access_token);
            console.log('refresh_token:', refresh_token);

            console.log(
                `Sucessfully retreived access token. Expires in ${expires_in} s.`
            );
            res.redirect('/create');

            setInterval(async () => {
                const data = await spotifyApi.refreshAccessToken();
                const access_token = data.body['access_token'];

                console.log('The access token has been refreshed!');
                console.log('access_token:', access_token);
                spotifyApi.setAccessToken(access_token);
            }, expires_in / 2 * 1000);
        })
        .catch(error => {
            console.error('Error getting Tokens:', error);
            res.send(`Error getting Tokens: ${error}`);
        });
});

// 'Create' route after successfully obtaining the access token and refresh token
app.get('/create', (req, res) => {
    res.render('create');
})

/*  Route for creating a playlist by obtaining user id, then from that user id
    the user's top tracks are obtained along with top artists. Then each
    artist's top 10 tracks are obtained and all of them are used for generating
    a playlist by determining the mood using a pre-trained model for detecting
    emotions in a python script run using spawn and filtering the tracks based
    on it.
*/
app.get('/playlist', async (req, res) => {
    const userid = await getMyData();
    console.log(userid);
    var topTracks = [];
    var trackFeatures = [];
    var topArtists = [];
    topTracks = await getTopTracks('short_term');
    topTracks.push(...await getTopTracks('medium_term'));
    topTracks.push(...await getTopTracks('long_term'));
    topTracks = [...new Set(topTracks)];
    console.log(topTracks.length, ' users top tracks')
    topArtists = await getTopArtists('short_term');
    topArtists.push(...await getTopArtists('medium_term'));
    topArtists.push(...await getTopArtists('long_term'));
    topArtists = [...new Set(topArtists)];
    console.log(topArtists.length, ' users top artists');
    for (artist of topArtists) {
        topTracks.push(...await getTopArtistTracks(artist));
    }
    topTracks = [...new Set(topTracks)];
    console.log(topTracks.length, `users top artist's tracks`);
    for (let i = 0; i < topTracks.length; i += 100) {
        let trackIds = topTracks.slice(i, Math.min(topTracks.length, i + 100));
        trackFeatures = await getTrackFeat(trackIds, trackFeatures);
    }
    console.log(trackFeatures.length, ' number of tracks with features');
    const playlistname = await generateTime();
    const playlistid = await createMyPlaylist(playlistname, {
        'description': playlistname,
        'public': false
    })
    console.log(playlistid);
    trackURIs = []
    aftersorttracks = trackFeatures;
    py = spawn('python', ['catchEmotion.py']);
    moods = "";
    py.stdout.on('data', function (data) {
        console.log('Pipe data from python script ...');
        var daa = data;
        moods += (daa.toString('utf8'));
    });
    py.stdout.on('end', function () {
        console.log('Moods', moods, moods.length);
        aftersorttracks = sortByValence(aftersorttracks);
        aftersorttracks = sortByDanceabilityAndEnergy(aftersorttracks);
        for (track of aftersorttracks) {
            trackURIs.push(track.uri);
        }
        console.log(aftersorttracks.length, ' no of selected tracks');
        for (let i = 0; i < trackURIs.length; i += 100) {
            let trackURIsliced = trackURIs.slice(i, Math.min(trackURIs.length, i + 100));
            addTracksToPlaylist(playlistid, trackURIsliced);
        }
        res.render('player', {
            playlistid
        })
    });
})

// Generating random name for playlist
async function generateTime() {
    let date_ob = new Date();
    let date = ("0" + date_ob.getDate()).slice(-2);
    let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
    let year = date_ob.getFullYear();
    let hours = date_ob.getHours();
    let minutes = date_ob.getMinutes();
    let seconds = date_ob.getSeconds();
    return year + "-" + month + "-" + date + " " + hours + ":" + minutes + ":" + seconds;
}

// Function to make calls to get user information
async function getMyData() {
    try {
        const myData = await spotifyApi.getMe();
        return myData.body.id;
    } catch (e) {
        console.log(e);
        return '';
    }
}

// Function to make call to get features of tracks, like valence, danceability and energy
async function getTrackFeat(topTracks, trackFeatures) {
    try {
        const data = await spotifyApi.getAudioFeaturesForTracks(topTracks);
        const tracks = data.body.audio_features;
        for (track of tracks) {
            if (track === null) {
                continue;
            }
            const {
                uri,
                valence,
                danceability,
                energy
            } = track;
            trackFeatures.push({
                uri: uri,
                valence: valence,
                danceability: danceability,
                energy: energy
            })
        }
        return trackFeatures;

    } catch (e) {
        console.log(e);

        return trackFeatures;
    }
}

// Function to make call to get a user's top 50 tracks, term maybe long term, medium term or short term
async function getTopTracks(term) {
    try {
        let topTracks = []
        const data = await spotifyApi.getMyTopTracks({
            limit: 50,
            time_range: term
        });
        data.body.items.forEach(track => {
            const {
                id,
                uri
            } = track;
            topTracks.push({
                id: id,
                uri: uri
            })
        })
        return topTracks
    } catch (e) {
        console.log(e);
        return []
    }
}

// Function to make call to create a new empty playlist
async function createMyPlaylist(name, options) {
    try {
        let playlistid = ''
        const playlistDetails = await spotifyApi.createPlaylist(name, options);
        playlistid = playlistDetails.body.id;
        return playlistid;
    } catch (e) {
        console.log(e);
        return '';
    }
}

// Function to make call to add tracks to a specific playlist given by its id
function addTracksToPlaylist(playlistid, trackURIs) {
    spotifyApi.addTracksToPlaylist(playlistid, trackURIs)
        .then(data => console.log(data))
        .catch(e => console.log(e));
}

// Function to make call to get top 50 artists of a user, term may be long term, medium term or short term
async function getTopArtists(term) {
    try {
        const data = await spotifyApi.getMyTopArtists({
            limit: 50,
            time_range: term,
        });
        const artists = data.body.items;
        var topArtists = []
        artists.forEach(artist => {
            topArtists.push(artist.id);
        })
        return topArtists;
    } catch (e) {
        console.log(e);
        return [];
    }
}

// Function to make call to get 10 tracks of a specified artist
async function getTopArtistTracks(topArtist) {
    try {
        var topTracks = []
        const data = await spotifyApi.getArtistTopTracks(topArtist, 'IN');
        const tracks = data.body.tracks;
        for (track of tracks) {
            topTracks.push(track.id);
        }
        return topTracks;
    } catch (e) {
        console.log(e);
        return [];
    }
}

// Function to filter tracks based on valence
function sortByValence(x) {
    if (moods.charAt(0) === '1') {
        x = x.filter(function (el) {
            return el.valence >= 0.55
        })
    } else if (moods.charAt(0) === '2') {
        x = x.filter(function (el) {
            return el.valence < 0.45
        })
    } else {
        x = x.filter(function (el) {
            return el.valence > 0.35 &&
                el.valence < 0.65
        })
    }
    return x;
}

// Function to filter tracks based on danceability and energy
function sortByDanceabilityAndEnergy(x) {
    if (moods.charAt(2) === '1') {
        x = x.filter(function (el) {
            return el.danceability >= 0.55 && el.energy >= 0.55;
        })
    } else if (moods.charAt(2) === '2') {
        x = x.filter(function (el) {
            return el.danceability < 0.45 &&
                el.energy < 0.45;
        })
    } else {
        x = x.filter(function (el) {
            return el.danceability > 0.35 &&
                el.danceability < 0.65 &&
                el.energy > 0.35 &&
                el.energy < 0.65
        })
    }
    return x;
}


app.listen(8888, () =>
    console.log(
        'HTTP Server up. Now go to http://localhost:8888/ in your browser.'
    )
);