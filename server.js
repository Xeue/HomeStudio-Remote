/* eslint-disable no-unused-vars */
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
const {exec} = require('child_process');
const fetch = require('node-fetch');

let webServer;
const __main = path.resolve(__dirname);
const __data = path.resolve(app.getPath('documents'));
const __static = path.resolve(__dirname+"/static");

const ejs = new electronEjs({'static': __static}, {});

const omeVersion = "dev";
//const omeVersion = "latest";
const dockerConfigPath = `${path.dirname(app.getPath('exe'))}/ome/`;
const dockerCommand = `docker run --name ome -d -e OME_HOST_IP=* --restart always -p 1935:1935 -p 9999:9999/udp -p 9000:9000 -p 8081:8081 -p 3333:3333 -p 3478:3478 -p 10000-10009:10000-10009/udp -p 20080:20081 -v ${dockerConfigPath}:/opt/ovenmediaengine/bin/origin_conf airensoft/ovenmediaengine:${omeVersion}`


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
		config.require('port', [], 'What port shall the server use?');
		config.require('systemName', [], 'What is the name of the system/job?');
		config.require('loggingLevel', {'A':'All', 'D':'Debug', 'W':'Warnings', 'E':'Errors'}, 'Set logging level:');
		config.require('createLogFile', {true: 'Yes', false: 'No'}, 'Save logs to local file?');
		config.require('advancedConfig', {true: 'Yes', false: 'No'}, 'Show advanced config settings?');
		{
			config.require('debugLineNum', {true: 'Yes', false: 'No'}, 'Print line numbers?', ['advancedConfig', true]);
			config.require('printPings', {true: 'Yes', false: 'No'}, 'Print pings?', ['advancedConfig', true]);
			config.require('devMode', {true: 'Yes', false: 'No'}, 'Dev mode - Disables connections to devices', ['advancedConfig', true]);
		}

		config.default('port', 8080);
		config.default('systemName', 'Home Studio');
		config.default('loggingLevel', 'W');
		config.default('homestudioKey', '');
		config.default('createLogFile', true);
		config.default('debugLineNum', false);
		config.default('printPings', false);
		config.default('advancedConfig', false);
		config.default('devMode', false);
		config.default('homestudioKey', '');
		config.default('omeType', 'docker');
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

	if (config.get('omeType') == 'docker') {
		log('Updaing Media Server config', ['C', 'SERVER', logs.g]);
		if (!fs.existsSync(dockerConfigPath)){
			fs.mkdirSync(dockerConfigPath);
		}
		fs.copyFile(`${__static}/ome/Server.xml`, `${dockerConfigPath}Server.xml`, (err) => {
			if (err) logs.error("Couldn't create OME config", err);
		});

		fs.copyFile(`${__static}/ome/Logger.xml`, `${dockerConfigPath}Logger.xml`, (err) => {
			if (err) logs.error("Couldn't create OME logging config", err);
		});
	
		log('Checking for Media Server', ['C', 'SHELL', logs.p]);
		const dockerList = await shellCommandPrintCollect("docker container ls --format='{{.Names}}'");
		if (!dockerList.includes('ome')) {
			log('No server found, creating Media Server', ['C', 'SHELL', logs.p]);
			await shellCommandPrint(dockerCommand);
		} else {
			log('Starting existing Media Server', ['C', 'SHELL', logs.p]);
			await shellCommandPrint('docker start ome');
		}
		
		log('Media Server Started', ['C', 'SHELL', logs.p]);
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
	mainWindow.webContents.send('loaded', `http://localhost:${config.get('port')}/app`);
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
	logs.setConf({
		'createLogFile': config.get('createLogFile'),
		'logsFileName': 'ArgosLogging',
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
			logs
		);
		await SQL.init(tables);
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
			encoders: encoders(),
			decoders: decoders(),
			host: config.get('host'),
			dockerCommand: dockerCommand
		});
	});
	expressApp.get('/app',  (req, res) =>  {
		log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		res.render('appHome', {
			systemName:config.get('systemName'),
			version: version,
			homestudioKey: config.get('homestudioKey'),
			encoders: encoders(),
			decoders: decoders(),
			host: config.get('host'),
			dockerCommand: dockerCommand
		});
	});
	expressApp.get('/getConfig', (req, res) => {
		log('Request for devices config', 'D');
		let catagory = req.query.catagory;
		let data;
		switch (catagory) {
		case 'encoders':
			data = encoders();
			break;
		case 'decoders':
			data = decoders();
			break;
		default:
			break;
		}
		res.send(JSON.stringify(data));
	});

	expressApp.post('/setencoders', (req, res) => {
		log('Request to set encoders config data', 'D');
		webServer.sendToAll({
			"command":"feeds",
			"feeds":req.body
		});
		writeData('Encoders', req.body);
		res.send('Done');
	});

	expressApp.post('/setdecoders', (req, res) => {
		log('Request to set decoders config data', 'D');
		writeData('Decoders', req.body);
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
	case 'startSRTPush':
		startPush(payload.id);
		await sleep(2);
		getPush();
		break;
	case 'stopSRTPush':
		stopPush(payload.id);
		await sleep(2);
		getPush();
		break;
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
		log(`Cloud not read the file ${file}.json, attempting to create new file`, 'W');
		logs.debug('File error:', error);
		const fileData = [];
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

async function shellCommandPrint(command) {
	return new Promise((resolve, reject) => {
		const proc = exec(command, {'shell':'powershell.exe'});
		proc.stdout.on('data', data => {
			const output = data.trim();
			if (output != "") log(output, ['C', 'SHELL', logs.p])
		});
		proc.stderr.on('data', data => {
			log(data, ['C', 'SHELL', logs.r])
		});
		proc.on('exit', code => {
			resolve(code);
		});
		proc.on('error', error => {
			reject(error);
		});
	});
}

async function shellCommandPrintCollect(command) {
	return new Promise((resolve, reject) => {
		let text = '';
		const proc = exec(command, {'shell':'powershell.exe'});
		proc.stdout.on('data', data => {
			const output = data.trim();
			text += output;
			if (output != "") log(output, ['C', 'SHELL', logs.p])
		});
		proc.stderr.on('data', data => {
			log(data, ['C', 'SHELL', logs.r])
		});
		proc.on('exit', () => {
			resolve(text);
		});
		proc.on('error', error => {
			reject(error);
		});
	});
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
	logs.debug(`Sending push request to: http://${config.get('host')}:8081/v1/vhosts/default/apps/app:startPush`);
	const response = await fetch(`http://${config.get('host')}:8081/v1/vhosts/default/apps/app:startPush`,{
		method: 'POST',
		headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')},
		body: JSON.stringify(body)
	})
	const jsonRpcResponse = await response.json();
	if (response.status !== 200) {
		logs.error('Could not reach OME server', response.statusText);
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
		"message": `Started pushing stream <pre <pre class="d-none" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
	});
	return jsonRpcResponse;
}

async function stopPush(id) {
	const body = {
		"id": "push_decoder_"+id
	}
	logs.debug(`Sending push request to: http://${config.get('host')}:8081/v1/vhosts/default/apps/app:stopPush`);
	const response = await fetch(`http://${config.get('host')}:8081/v1/vhosts/default/apps/app:stopPush`,{
		method: 'POST',
		headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')},
		body: JSON.stringify(body)
	})
	const jsonRpcResponse = await response.json();
	if (response.status !== 200) {
		logs.error('Could not reach OME server', response.statusText);
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
		"message": `Stopped pushing stream <pre class="d-none" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
	});
	return jsonRpcResponse;
}

async function getPush(id) {
	const postOptions = {
		method: 'POST',
		headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')}
	}
	if (id) postOptions.body = JSON.stringify({"id": "push_decoder_"+id});
	logs.debug(`Getting pushes from to: http://${config.get('host')}:8081/v1/vhosts/default/apps/app:pushes`);
	const response = await fetch(`http://${config.get('host')}:8081/v1/vhosts/default/apps/app:pushes`, postOptions)
	const jsonRpcResponse = await response.json();
	if (response.status !== 200) {
		logs.error('Could not reach OME server', response.statusText);
		webServer.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Error getting pushes: ${response.statusText}, <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
		});
		return;
	}
	webServer.sendToAll({
		"command": "log",
		"type": "pushStatus",
		"message": jsonRpcResponse
	});
	return jsonRpcResponse;
}