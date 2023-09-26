# HomeStudio-Remote
HomeStudio running localy

# Headless version
If the app detects that it is not attached to an active terminal it will create a default config if one doesn't already exist
Otherwise it will wait for 10 for the user to initiate the creation of the config, after which it will create a default one
The config can be found in the install directory/HomeStudioData along with the logs and the config data


## Pages
About: ADDRESS:PORT/about - Can view the current config and encoders/decoders setup
Config: ADDRESS:PORT/config - Can set and edit the encoders and decoders config
Thumnails: ADDRESS:PORT/thumnails - Can view the thumbnails of all current feeds
Advanced: ADDRESS:PORT/advanced - Can view live video and edit the advanced multiview layouts
Basic: ADDRESS:PORT/basic - Can view the live video in the simple preset layouts

## Installation
This is a completely standard node app, so to install clone or download this repository, then run "npm install" followed by "npm start"

## Default config:
{
	"port":8080,
	"systemName":"Home Studio",
	"loggingLevel":"W",
	"homestudioKey":"",
	"defaultLayout":"basic",
	"allowLowres":true,
	"allowSearch":true,
	"createLogFile":true,
	"debugLineNum":false,
	"printPings":false,
	"advancedConfig":false,
	"devMode":false,
	"omeType":"none",
	"host":"localhost",
	"reconnectTimeoutSeconds":4
}