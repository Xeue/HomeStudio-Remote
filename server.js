/* eslint-disable no-unused-vars */
const fs = require('fs');
const express = require('express');
const path = require('path');
const {Logs} = require('xeue-logs');
const {Config} = require('xeue-config');
const {Server} = require('xeue-webserver');
const {version} = require('./package.json');
const {Shell} = require('xeue-shell');
const {app, BrowserWindow, ipcMain, Tray, Menu} = require('electron');
const AutoLaunch = require('auto-launch');
const fetch = require('node-fetch');
const ejse = require('ejs-electron');
const {MicaBrowserWindow, IS_WINDOWS_11} = require('mica-electron');

const background = IS_WINDOWS_11 ? 'micaActive' : 'bg-dark';

const __main = path.resolve(__dirname);
const __data = path.resolve(app.getPath('documents'));
const __static = path.resolve(__dirname+"/static");


const logger = new Logs(
	false,
	'HomeStudioLogging',
	path.join(__data, 'HomeStudioData'),
	'D',
	false
)
const config = new Config(
	logger
);
const webServer = new Server(
	expressRoutes,
	logger,
	version,
	config,
	doMessage
);

ejse.data('static',  __static);
ejse.data('background',  background);

const omeVersion = "dev";
const dockerConfigPath = `${path.dirname(app.getPath('exe'))}/ome/`;
const dockerCommand = `docker run --name ome -d -e OME_HOST_IP=* --restart always -p 1935:1935 -p 9998:9998 -p 9999:9999/udp -p 9000:9000 -p 8081:8081 -p 3333:3333 -p 3478:3478 -p 10000-10009:10000-10009/udp -p 20080:20081 -v ${dockerConfigPath}:/opt/ovenmediaengine/bin/origin_conf airensoft/ovenmediaengine:${omeVersion}`


let isQuiting = false;
let mainWindow = null;
let configLoaded = false;

/* Start App */

(async () => {

	await app.whenReady();
	await setUpApp();
	await createWindow();

	{ /* Config */
		logger.printHeader('HomeStudio');
		config.require('omeType', {
			'docker':'Docker',
			'native':'Installed Locally',
			'none':'Not Installed'
		}, 'Home Studio Remote requires \'Oven Media Engine\' to be running to function, this can be done via docker on windows or installed localy if using linux.\nIf you select Docker Home Studio will try and install the image automatically.\n\nInstallation type:');
		{
			config.info('omeNative', 'The Server.xml file created for Home Studio Remote can be found at IP:PORT/ome/Server.xml', ['omeType', 'native']);
			config.info('omeDocker', `If setup of OME has failed try using this command manually in your command prompt: <code class="bg-secondary card d-block m-1 my-3 p-1 px-2 text-light position-static">${dockerCommand}</code>`, ['omeType', 'docker']);
		}
		config.require('host', [], 'What is the IP/host of Oven Media Engine? (normally this machines IP)');
		config.require('port', [], 'What port shall the server use');
		config.require('systemName', [], 'What is the name of the system/job');
		config.require('defaultLayout', {'thumnail': 'Thumnails Only', 'basic':'Basic Presets','advanced': 'Advanced With Editor'}, 'What should the default view be when a user connects');
		config.require('allowLowres', {true: 'Yes', false: 'No'}, 'Generate lowres proxys for small pips');
		config.require('allowSearch', {true: 'Yes', false: 'No'}, 'Enable search for long thumbnail lists');
		config.require('reconnectTimeoutSeconds', [], 'How long should a stream wait before trying to reconnect in the GUI');
		config.require('loggingLevel', {'A':'All', 'D':'Debug', 'W':'Warnings', 'E':'Errors'}, 'Set logging level:');
		config.require('createLogFile', {true: 'Yes', false: 'No'}, 'Save Logs to local file');
		config.require('advancedConfig', {true: 'Yes', false: 'No'}, 'Show advanced config settings');
		{
			config.require('debugLineNum', {true: 'Yes', false: 'No'}, 'Print line numbers?', ['advancedConfig', true]);
			config.require('printPings', {true: 'Yes', false: 'No'}, 'Print pings?', ['advancedConfig', true]);
			config.require('devMode', {true: 'Yes', false: 'No'}, 'Dev mode - Disables connections to devices', ['advancedConfig', true]);
		}

		config.default('port', 8080);
		config.default('systemName', 'Home Studio');
		config.default('loggingLevel', 'W');
		config.default('homestudioKey', '');
		config.default('defaultLayout', 'basic');
		config.default('allowLowres', true);
		config.default('allowSearch', true);
		config.default('createLogFile', true);
		config.default('debugLineNum', false);
		config.default('printPings', false);
		config.default('advancedConfig', false);
		config.default('devMode', false);
		config.default('homestudioKey', '');
		config.default('omeType', 'docker');
		config.default('host', 'localhost');
		config.default('reconnectTimeoutSeconds', 4);


		if (!await config.fromFile(path.join(__data, 'HomeStudioData', 'config.conf'))) {
			await config.fromAPI(path.join(app.getPath('documents'), 'HomeStudioData', 'config.conf'), configQuestion, configDone);
		}

		if (config.get('loggingLevel') == 'D' || config.get('loggingLevel') == 'A') {
			config.set('debugLineNum', true);
		}

		logger.setConf(
			config.get('createLogFile'),
			'HomeStudioLogging',
			path.join(__data, 'HomeStudioData'),
			config.get('loggingLevel'),
			config.get('debugLineNum')
		)

		logger.log('Running version: v'+version, ['H', 'SERVER', logger.g]);
		logger.log(`Logging to: ${path.join(__data, 'HomeStudioData', 'Logs')}`, ['H', 'SERVER', logger.g]);
		logger.log(`Config saved to: ${path.join(__data, 'HomeStudioData', 'config.conf')}`, ['H', 'SERVER', logger.g]);
		config.print();
		config.userInput(async command => {
			switch (command) {
			case 'config':
				await config.fromCLI(path.join(__data, 'HomeStudioData', 'config.conf'));
				if (config.get('loggingLevel') == 'D' || config.get('loggingLevel') == 'A') {
					config.set('debugLineNum', true);
				}
				logger.setConf({
					'createLogFile': config.get('createLogFile'),
					'LogsFileName': 'HomeStudioLogging',
					'configLocation': path.join(__data, 'HomeStudioData'),
					'loggingLevel': config.get('loggingLevel'),
					'debugLineNum': config.get('debugLineNum')
				});
				return true;
			}
		});
		configLoaded = true;
	}

	if (config.get('omeType') == 'docker') await startDocker();

	logger.log(`${config.get('systemName')} can be accessed at http://${config.get('host')}:${config.get('port')}`, ['H', 'SERVER', logger.g]);

	webServer.start(config.get('port'));
	mainWindow.webContents.send('loaded', `http://localhost:${config.get('port')}/app`);
	const Decoders = decoders()
	for (let index = 0; index < Decoders.length; index++) {
		const decoder = Decoders[index];
		startPush(decoder.ID);
		await sleep(0.2);
	}
	setInterval(getPush, 10*1000);
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
			logger.log('Not implemeneted yet: Cancle config change');
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

	logger.on('logSend', message => {
		if (!isQuiting) mainWindow.webContents.send('log', message);
	});
}

async function createWindow() {
	const windowOptions = {
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
	};

	if (IS_WINDOWS_11) {
		mainWindow = new MicaBrowserWindow(windowOptions);
		mainWindow.setDarkTheme();
		mainWindow.setMicaEffect();
	} else {
		mainWindow = new BrowserWindow(windowOptions);
	}

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

	mainWindow.loadURL('file://' + __main + '/views/app.ejs');

	await new Promise(resolve => {
		ipcMain.on('ready', (event, ready) => {
			if (configLoaded) {
				mainWindow.webContents.send('loaded', `http://localhost:${config.get('port')}/app`);
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
			if (!isNaN(newVal) && (value.match(/./g) || []).length < 2) value = newVal;
			resolve(value);
		});
	});
	return awaitMessage;
}

async function configDone() {
	mainWindow.webContents.send('configDone', true);
	logger.setConf({
		'createLogFile': config.get('createLogFile'),
		'LogsFileName': 'ArgosLogging',
		'configLocation': path.join(app.getPath('documents'), 'ArgosData'),
		'loggingLevel': config.get('loggingLevel'),
		'debugLineNum': config.get('debugLineNum'),
	});
	if (configLoaded) mainWindow.webContents.send('loaded', `http://localhost:${config.get('port')}/app`);
	if (config.get('localDataBase')) {
		SQL = new SQLSession(
			config.get('dbHost'),
			config.get('dbPort'),
			config.get('dbUser'),
			config.get('dbPass'),
			config.get('dbName'),
			Logs
		);
		await SQL.init(tables);
	}
}

async function startDocker() {
	const shell = new Shell(logger, 'DOCKER', 'D', 'powershell.exe');

	logger.log('Updating Media Server config', ['C', 'SERVER', logger.g]);

	if (!fs.existsSync(dockerConfigPath)) fs.mkdirSync(dockerConfigPath);
	if (config.get('allowLowres')) {
		fs.copyFile(`${__static}/ome/ServerProxy.xml`, `${dockerConfigPath}Server.xml`, (err) => {
			if (err) logger.error("Couldn't create OME config", err);
		});
	} else {
		fs.copyFile(`${__static}/ome/Server.xml`, `${dockerConfigPath}Server.xml`, (err) => {
			if (err) logger.error("Couldn't create OME config", err);
		});
	}
	fs.copyFile(`${__static}/ome/Logger.xml`, `${dockerConfigPath}Logger.xml`, (err) => {
		if (err) logger.error("Couldn't create OME logging config", err);
	});

	logger.log('Checking for docker setup', ['C', 'DOCKER', logger.p]);
	const dockerFullVersion = await shell.run("docker version");
	if (dockerFullVersion.hasErrors) {
		logger.log('Cannot connect to docker, checking if it is installed', ['C', 'DOCKER', logger.r]);
		const dockerVersion = await shell.run("docker --version");
		if (dockerVersion.hasErrors) {
			logger.log('Docker is not installed, please install docker on this system to continue', ['C', 'DOCKER', logger.r]);
			return;
		}
		logger.log('Docker is installed, attempting to start docker', ['C', 'DOCKER', logger.p]);
		const dockerStart = await shell.run('Start-Process "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"');
		if (dockerStart.hasErrors) {
			logger.log('Docker could not be started automatically, try running homestudio as an admin user', ['C', 'DOCKER', logger.r]);
			return;
		}
		const dockerNewFullVersion = await shell.run("docker version");
		if (dockerNewFullVersion.hasErrors) {
			logger.log('Docker could not be started automatically, try running homestudio as an admin user', ['C', 'DOCKER', logger.r]);
			return;
		}
		logger.log('Docker started', ['C', 'DOCKER', logger.p]);
	}

	logger.log('Checking for Media Server', ['C', 'DOCKER', logger.p]);
	const dockerContainer = await shell.run("docker container ls --format='{{.Names}}'");
	if (dockerContainer.stdout.includes('ome')) {
		logger.log('Starting existing Media Server', ['C', 'DOCKER', logger.p]);
		await shell.run("docker start ome");
		logger.log('Media Server Started', ['C', 'DOCKER', logger.p]);
	} else if (dockerContainer.hasErrors) {
		logger.log('Cannot connect to docker, please make sure it is running', ['C', 'DOCKER', logger.r]);
	} else {
		logger.log('No server found, creating Media Server', ['C', 'DOCKER', logger.p]);
		await shell.run(dockerCommand);
		logger.log('Media Server Created and Started', ['C', 'DOCKER', logger.p]);
	}
}


function encoders(type) {
	const Encoders = loadData('Encoders');
	if (type !== undefined) return Encoders.filter(encoder => encoder.Type == type);
	return Encoders;
}

function decoders(id) {
	const Decoders = loadData('Decoders');
	if (id !== undefined) return Decoders.filter(decoder => decoder.ID == id);
	return Decoders;
}

function layouts(id) {
	const Layouts = loadData('Layouts');
	if (id !== undefined) return Layouts.filter(layout => layout.ID == id);
	return Layouts;
}

function expressRoutes(expressApp) {
	expressApp.set('views', path.join(__main, 'views'));
	expressApp.set('view engine', 'ejs');
	expressApp.use(express.json());
	expressApp.use(express.static(__static));

	function getHomeOptions() {return {
		systemName: config.get('systemName'),
		version: version,
		homestudioKey: config.get('homestudioKey'),
		encoders: encoders(),
		decoders: decoders(),
		layouts: layouts(),
		host: config.get('host'),
		dockerCommand: dockerCommand,
		reconnectTimeoutSeconds: config.get('reconnectTimeoutSeconds'),
		allowLowres: config.get('allowLowres'),
		allowSearch: config.get('allowSearch'),
		background: background
	}}

	expressApp.get('/',  (req, res) =>  {
		logger.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = config.get('defaultLayout');
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/config',  (req, res) =>  {
		logger.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = true;
		homeOptions.layout = "thumbnail";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/advanced',  (req, res) =>  {
		logger.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = "advanced";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/basic',  (req, res) =>  {
		logger.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = "basic";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/thumbnails',  (req, res) =>  {
		logger.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = "thumbnail";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/app',  (req, res) =>  {
		logger.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = true;
		homeOptions.layout = "thumbnail";
		homeOptions.inApp = true;
		res.render('home', homeOptions);
	});
	expressApp.get('/about',  async (req, res) =>  {
		logger.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const shell = new Shell(logger, 'DOCKER', 'D', 'powershell.exe');
		const dockerFullVersion = await shell.run("docker version");
		const dockerDetails = {};
		String(dockerFullVersion.stdout).split('\n').forEach(line => {
			const trimmed = line.replace(/  /g, '');
			const split = trimmed.split(':');
			const key = split[0].trim();
			const val = split[1]?.trim();
			if (key && val) dockerDetails[key] = val;
		})
		const aboutInfo = {
			'aboutInfo': {
				'Version': version,
				'Config': config.all(),
				'Docker': dockerDetails,
				'Layouts': layouts(),
				'Encoders': encoders(),
				'Decoders': decoders()
			},
			'systemName': config.get('systemName')
		}
		res.render('about', aboutInfo);
	});

	expressApp.get('/getConfig', (req, res) => {
		logger.log('Request for devices config', 'D');
		let catagory = req.query.catagory;
		let data;
		switch (catagory) {
		case 'encoders':
			data = encoders();
			break;
		case 'decoders':
			data = decoders();
			break;
		case 'layouts':
			data = layouts();
			break;
		default:
			break;
		}
		res.send(JSON.stringify(data));
		getPush();
	});

	expressApp.post('/setencoders', (req, res) => {
		logger.log('Request to set encoders config data', 'D');
		webServer.sendToAll({
			"command":"feeds",
			"feeds":req.body
		});
		writeData('Encoders', req.body);
		res.send('Done');
	});
	expressApp.post('/setdecoders', (req, res) => {
		logger.log('Request to set decoders config data', 'D');
		writeData('Decoders', req.body);
		res.send('Done');
	});
	expressApp.post('/setlayouts', (req, res) => {
		logger.log('Request to set layouts config data', 'D');
		webServer.sendToAll({
			"command":"layouts",
			"layouts":req.body
		});
		writeData('Layouts', req.body);
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
		logger.log('Client registered', 'A');
		break;
	case 'startSRTPush':
		startPush(payload.id);
		await sleep(1);
		getPush();
		break;
	case 'stopSRTPush':
		stopPush(payload.id);
		await sleep(1);
		getPush();
		break;
	case 'startSRTAll': {
		const Decoders = decoders()
		for (let index = 0; index < Decoders.length; index++) {
			const decoder = Decoders[index];
			startPush(decoder.ID);
			await sleep(0.2);
			getPush(decoder.ID);
		}
		getPush();
		break;
	}
	case 'stopSRTAll': {
		const Decoders = decoders()
		for (let index = 0; index < Decoders.length; index++) {
			const decoder = Decoders[index];
			stopPush(decoder.ID);
			await sleep(0.2);
			getPush(decoder.ID);
		}
		getPush();
		break;
	}
	case 'getSRTPush':
		getPush(payload.id);
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
		logger.log(`Cloud not read the file ${file}.json, attempting to create new file`, 'W');
		logger.debug('File error:', error);
		let fileData = [];
		switch (file) {
		case 'Encoders':
			fileData[0] = {
				'Name':'Camera 1',
				'ID':1,
				'Type':'Local Encoder',
				'URL':'ws://IPAddress:3333/app/feed1',
				'Encoder':'srt://IPAddress:9999/app?streamid=srt://IPAddress:9999/app/feed1'
			};
			break;
		case 'Decoders':
			fileData[0] = {
				'Name':'Decoder 1',
				'ID':1,
				'URL':'ws://IPAddress:3333',
				'Feed':'Feed1'
			};
			break;
		case 'Layouts':
			fileData = [
				{
					"Name": "Fullframe",
					"ID": 1,
					"Columns": 1,
					"Rows": 1,
					"Pips": {
						"1": {
							"rowStart": 1,
							"rowEnd": 1,
							"colStart": 1,
							"colEnd": 1
						}
					},
					"Mapping": {}
				},
				{
					"Name": "Dual",
					"ID": 2,
					"Columns": 2,
					"Rows": 1,
					"Pips": {
						"1": {
							"rowStart": 1,
							"rowEnd": 1,
							"colStart": 1,
							"colEnd": 1
						},
						"2": {
							"rowStart": 1,
							"rowEnd": 1,
							"colStart": 2,
							"colEnd": 2
						}
					},
					"Mapping": {}
				},
				{
					"Name": "Quad",
					"ID": 3,
					"Columns": 2,
					"Rows": 2,
					"Pips": {
						"1": {
							"rowStart": 1,
							"rowEnd": 1,
							"colStart": 1,
							"colEnd": 1
						},
						"2": {
							"rowStart": 1,
							"rowEnd": 1,
							"colStart": 2,
							"colEnd": 2
						},
						"3": {
							"rowStart": 2,
							"rowEnd": 2,
							"colStart": 1,
							"colEnd": 1
						},
						"4": {
							"rowStart": 2,
							"rowEnd": 2,
							"colStart": 2,
							"colEnd": 2
						}
					},
					"Mapping": {}
				}
			]
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

async function sleep(seconds) {
	await new Promise (resolve => setTimeout(resolve, 1000*seconds));
}

async function startPush(id) {
	const decoderConfig = decoders(id)[0];
	const body = {
		"id": "push_decoder_"+id,
		"stream": {
		 	"name": decoderConfig.Feed
		},
		"protocol": "srt",
		"url": decoderConfig.URL+"?mode=caller"
	}
	logger.debug(`Sending push request to: http://${config.get('host')}:8081/v1/vhosts/default/apps/app:startPush`);
	try {
		const response = await fetch(`http://${config.get('host')}:8081/v1/vhosts/default/apps/app:startPush`,{
			method: 'POST',
			headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')},
			body: JSON.stringify(body)
		})
		const jsonRpcResponse = await response.json();
		if (response.status !== 200) {
			logger.warn('Could not reach OME server', response.statusText);
			webServer.sendToAll({
				"command": "log",
				"type": "decoding",
				"message": `Error pushing stream: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
			});
			return;
		}
		webServer.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Started pushing stream: <pre <pre class="d-none" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
		});
		return jsonRpcResponse;
	} catch (error) {
		logger.warn('Could not reach OME server', error);
		webServer.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Error pushing stream: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(error, null, 4)}</pre>`
		});
		return;
	}
}

async function stopPush(id) {
	const body = {
		"id": "push_decoder_"+id
	}
	logger.debug(`Sending push request to: http://${config.get('host')}:8081/v1/vhosts/default/apps/app:stopPush`);
	try {
		const response = await fetch(`http://${config.get('host')}:8081/v1/vhosts/default/apps/app:stopPush`,{
			method: 'POST',
			headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')},
			body: JSON.stringify(body)
		})
		const jsonRpcResponse = await response.json();
		if (response.status !== 200) {
			logger.warn('Could not reach OME server', response.statusText);
			webServer.sendToAll({
				"command": "log",
				"type": "decoding",
				"message": `Error stopping stream: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
			});
			return;
		}
		webServer.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Stopped pushing stream: <pre class="d-none" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
		});
		return jsonRpcResponse;	
	} catch (error) {
		logger.warn('Could not reach OME server', error);
		webServer.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Error stopping stream: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(error, null, 4)}</pre>`
		});
		return;
	}
}

async function getPush(id) {
	const postOptions = {
		method: 'POST',
		headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')}
	}
	if (id) postOptions.body = JSON.stringify({"id": "push_decoder_"+id});
	logger.log(`Getting pushes from to: http://${config.get('host')}:8081/v1/vhosts/default/apps/app:pushes`, 'A');
	try {
		const response = await fetch(`http://${config.get('host')}:8081/v1/vhosts/default/apps/app:pushes`, postOptions)
		const jsonRpcResponse = await response.json();
		if (response.status !== 200) {
			logger.warn('Could not reach OME server', response.statusText);
			webServer.sendToAll({
				"command": "log",
				"type": "decoding",
				"message": `Error getting pushes: ${response.statusText}: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
			});
			return;
		}
		webServer.sendToAll({
			"command": "log",
			"type": "pushStatus",
			"message": jsonRpcResponse
		});
		return jsonRpcResponse;
	} catch (error) {
		logger.warn('Could not reach OME server', error);
		webServer.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Error getting pushes cannot connect to server: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(error, null, 4)}</pre>`
		});
		return;
	}
}