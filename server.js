/* eslint-disable no-unused-vars */
//const fetch = require('node-fetch');
const fs = require('fs');
const express = require('express');
const path = require('path');
const {log, logObj, logs, logEvent} = require('xeue-logs');
const {config} = require('xeue-config');
const {Server} = require('xeue-webserver');
const {version} = require('./package.json');
const electronEjs = require('electron-ejs');
const {app, BrowserWindow, ipcMain, Tray, Menu} = require('electron');
const AutoLaunch = require('auto-launch');

let webServer;
const __main = path.resolve(__dirname);
const __data = path.resolve(__dirname);
const __static = path.resolve(__dirname+"/static");

const ejs = new electronEjs({'static': __static}, {});

let isQuiting = false;
let mainWindow = null;
let configLoaded = false;

/* Start App */

(async () => {

	await app.whenReady();
	await setUpApp();
	await createWindow();

	{ /* Config */
		logs.printHeader('HomeStudio');
		config.useLogger(logs);
		config.require('host', [], 'What is the IP/host of this system?');
		config.require('omesetup', {true: 'Done', false: 'Continue Without'}, `To run Home Studio Remote you must first intall docker and then instal Oven Media Engine in docker using this command:
		<code class="bg-secondary card d-block m-1 my-3 p-1 px-2 text-light">docker run --name ome -d -e OME_HOST_IP=localhost -p 1935:1935 -p 9999:9999/udp -p 9000:9000 -p 3333:3333 -p 3478:3478 -p 10000-10009:10000-10009/udp airensoft/ovenmediaengine:latest</code>
		(Change OME_HOST_IP from 'localhost' to the IP of this machine if required)
		<br />
		Confirm bellow when this has been done`);
		config.require('port', [], 'What port shall the server use');
		config.require('systemName', [], 'What is the name of the system/job');
		config.require('loggingLevel', {'A':'All', 'D':'Debug', 'W':'Warnings', 'E':'Errors'}, 'Set logging level');
		config.require('createLogFile', {true: 'Yes', false: 'No'}, 'Save logs to local file');
		config.require('advancedConfig', {true: 'Yes', false: 'No'}, 'Show advanced config settings');
		{
			config.require('debugLineNum', {true: 'Yes', false: 'No'}, 'Print line numbers', ['advancedConfig', true]);
			config.require('printPings', {true: 'Yes', false: 'No'}, 'Print pings', ['advancedConfig', true]);
			config.require('devMode', {true: 'Yes', false: 'No'}, 'Dev mode - Disables connections to devices', ['advancedConfig', true]);
		}

		config.default('port', 8080);
		config.default('systemName', 'Unknown');
		config.default('loggingLevel', 'W');
		config.default('homestudioKey', '');
		config.default('createLogFile', true);
		config.default('debugLineNum', false);
		config.default('printPings', false);
		config.default('advancedConfig', false);
		config.default('devMode', false);
		config.default('homestudioKey', '');
		config.default('omesetup', false);
		config.default('host', 'localhost');

		if (!await config.fromFile(path.join(__data, 'HomeStudioData', 'config.conf'))) {
			await config.fromAPI(path.join(app.getPath('documents'), 'HomeStudioData', 'config.conf'), configQuestion, configDone);
		}

		if (config.get('loggingLevel') == 'D' || config.get('loggingLevel') == 'A') {
			config.set('debugLineNum', true);
		}

		logs.setConf({
			'createLogFile': config.get('createLogFile'),
			'logsFileName': 'HomeStudioLogging',
			'configLocation': path.join(__data, 'HomeStudioData'),
			'loggingLevel': config.get('loggingLevel'),
			'debugLineNum': config.get('debugLineNum'),
		});
		log('Running version: v'+version, ['H', 'SERVER', logs.g]);
		log(`Logging to: ${path.join(__data, 'HomeStudioData', 'logs')}`, ['H', 'SERVER', logs.g]);
		log(`Config saved to: ${path.join(__data, 'HomeStudioData', 'config.conf')}`, ['H', 'SERVER', logs.g]);
		config.print();
		config.userInput(async command => {
			switch (command) {
			case 'config':
				await config.fromCLI(path.join(__data, 'HomeStudioData', 'config.conf'));
				if (config.get('loggingLevel') == 'D' || config.get('loggingLevel') == 'A') {
					config.set('debugLineNum', true);
				}
				logs.setConf({
					'createLogFile': config.get('createLogFile'),
					'logsFileName': 'HomeStudioLogging',
					'configLocation': path.join(__data, 'HomeStudioData'),
					'loggingLevel': config.get('loggingLevel'),
					'debugLineNum': config.get('debugLineNum')
				});
				return true;
			}
		});
		configLoaded = true;
	}

	webServer = new Server(
		config.get('port'),
		expressRoutes,
		logs,
		version,
		config,
		doMessage
	);

	log(`HomeStudio Local can be accessed at http://localhost:${config.get('port')}`, 'C');

	webServer.start();
	mainWindow.webContents.send('loaded', `http://localhost:${config.get('port')}`);
})().catch(error => {
	console.log(error);
});


/* Electron */


async function setUpApp() {
	const tray = new Tray(path.join(__static, 'img/icon/icon-96x96.png'));
	tray.setContextMenu(Menu.buildFromTemplate([
		{
			label: 'Show App', click: function () {
				mainWindow.show();
			}
		},
		{
			label: 'Exit', click: function () {
				isQuiting = true;
				app.quit();
			}
		}
	]));

	ipcMain.on('window', (event, message) => {
		switch (message) {
		case 'exit':
			app.quit();
			break;
		case 'minimise':
			mainWindow.hide();
			break;
		default:
			break;
		}
	});

	ipcMain.on('config', (event, message) => {
		switch (message) {
		case 'start':
			config.fromAPI(path.join(app.getPath('documents'), 'HomeStudioData','config.conf'), configQuestion, configDone);
			break;
		case 'stop':
			log('Not implemeneted yet: Cancle config change');
			break;
		case 'show':
			config.print();
			break;
		default:
			break;
		}
	});

	const autoLaunch = new AutoLaunch({
		name: 'Home Studio',
		isHidden: true,
	});
	autoLaunch.isEnabled().then(isEnabled => {
		if (!isEnabled) autoLaunch.enable();
	});

	app.on('before-quit', function () {
		isQuiting = true;
	});

	app.on('activate', async () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});

	logEvent.on('logSend', message => {
		if (!isQuiting) mainWindow.webContents.send('log', message);
	});
}

async function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 720,
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			preload: path.resolve(__main, 'preload.js')
		},
		icon: path.join(__static, 'img/icon/icon-512x512.png'),
		show: false,
		frame: false,
		titleBarStyle: 'hidden',
		titleBarOverlay: {
			color: '#313d48',
			symbolColor: '#ffffff',
			height: 56
		}
	});

	if (!app.commandLine.hasSwitch('hidden')) {
		mainWindow.show();
	} else {
		mainWindow.hide();
	}

	mainWindow.on('close', function (event) {
		if (!isQuiting) {
			event.preventDefault();
			mainWindow.webContents.send('requestExit');
			event.returnValue = false;
		}
	});

	mainWindow.on('minimize', function (event) {
		event.preventDefault();
		mainWindow.hide();
	});

	mainWindow.loadURL(path.resolve(__main, 'views/app.ejs'));

	await new Promise(resolve => {
		ipcMain.on('ready', (event, ready) => {
			if (configLoaded) {
				mainWindow.webContents.send('loaded', `http://localhost:${config.get('port')}`);
			}
			resolve();
		});
	});
}


/* Config Functions */


async function configQuestion(question, current, options) {
	mainWindow.webContents.send('configQuestion', JSON.stringify({
		'question': question,
		'current': current,
		'options': options
	}));
	const awaitMessage = new Promise (resolve => {
		ipcMain.once('configMessage', (event, value) => {
			if (value == 'true') value = true;
			if (value == 'false') value = false;
			const newVal = parseInt(value);
			if (!isNaN(newVal)) value = newVal;
			resolve(value);
		});
	});
	return awaitMessage;
}

async function configDone() {
	mainWindow.webContents.send('configDone', true);
	logs.setConf({
		'createLogFile': config.get('createLogFile'),
		'logsFileName': 'ArgosLogging',
		'configLocation': path.join(app.getPath('documents'), 'ArgosData'),
		'loggingLevel': config.get('loggingLevel'),
		'debugLineNum': config.get('debugLineNum'),
	});
	if (configLoaded) mainWindow.webContents.send('loaded', `http://localhost:${config.get('port')}`);
	if (config.get('localDataBase')) {
		SQL = new SQLSession(
			config.get('dbHost'),
			config.get('dbPort'),
			config.get('dbUser'),
			config.get('dbPass'),
			config.get('dbName'),
			logs
		);
		await SQL.init(tables);
	}
}


function streams(type) {
	const Streams = loadData('Streams');
	if (type !== undefined) return Streams.filter(Stream => Stream.Type == type);
	return Streams;
}

function expressRoutes(expressApp) {
	expressApp.set('views', path.join(__main, 'views'));
	expressApp.set('view engine', 'ejs');
	expressApp.use(express.json());
	expressApp.use(express.static(__static));

	expressApp.get('/',  (req, res) =>  {
		log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		res.render('home', {
			systemName:config.get('systemName'),
			version: version,
			homestudioKey: config.get('homestudioKey'),
			streams: streams(),
			host: config.get('host')
		});
	});
	expressApp.get('/getConfig', (req, res) => {
		log('Request for devices config', 'D');
		let catagory = req.query.catagory;
		let data;
		switch (catagory) {
		case 'streams':
			data = streams();
			break;
		default:
			break;
		}
		res.send(JSON.stringify(data));
	});

	expressApp.post('/setstreams', (req, res) => {
		log('Request to set streams config data', 'D');
		writeData('Streams', req.body);
		res.send('Done');
	});
}

async function doMessage(msgObj, socket) {
	const payload = msgObj.payload;
	const header = msgObj.header;
	if (typeof payload.source == 'undefined') {
		payload.source = 'default';
	}
	switch (payload.command) {
	case 'meta':
		logObj('Received', msgObj, 'D');
		socket.send('Received meta');
		break;
	case 'setKey':
		config.set('homestudioKey', payload.key);
		break;
	case 'register':
		logs.log('Client registered', 'A');
		break;
	default:
		logObj('Unknown message', msgObj, 'W');
	}
}

function loadData(file) {
	try {
		const dataRaw = fs.readFileSync(`${__data}/HomeStudioData/data/${file}.json`);
		try {
			return JSON.parse(dataRaw);
		} catch (error) {
			logObj(`There is an error with the syntax of the JSON in ${file}.json file`, error, 'E');
			return [];
		}
	} catch (error) {
		log(`Cloud not read the file ${file}.json, attempting to create new file`, 'W');
		logs.debug('File error:', error);
		const fileData = [];
		switch (file) {
		case 'Streams':
			fileData[0] = {
				'Name':'Camera #',
				'Type':'Local Encoder',
				'URL':'ws://IPAddress:3333/app/camera-#',
				'Encoder':'srt://IPAddress:9999/app?streamid=srt://IPAddress:9999/app/camera-#'
			};
			break;
		default:
			break;
		}
		if (!fs.existsSync(`${__data}/HomeStudioData/data/`)){
			fs.mkdirSync(`${__data}/HomeStudioData/data/`);
		}
		fs.writeFileSync(`${__data}/HomeStudioData/data/${file}.json`, JSON.stringify(fileData, null, 4));
		return fileData;
	}
}
function writeData(file, data) {
	try {
		fs.writeFileSync(`${__data}/HomeStudioData/data/${file}.json`, JSON.stringify(data, undefined, 2));
	} catch (error) {
		logObj(`Cloud not write the file ${file}.json, do we have permission to access the file?`, error, 'E');
	}
}