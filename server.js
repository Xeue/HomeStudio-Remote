/* eslint-disable no-unused-vars */
const fs = require('fs');
const express = require('express');
const path = require('path');
const _Logs = require('xeue-logs').Logs;
const _Config = require('xeue-config').Config;
const _Server = require('xeue-webserver').Server;
const {version} = require('./package.json');
const _Shell = require('xeue-shell').Shell;
const _Pipeline = require('./pipeline.js').Pipeline;
const {app, BrowserWindow, ipcMain, Tray, Menu} = require('electron');
const AutoLaunch = require('auto-launch');
const fetch = require('node-fetch');
const ejse = require('ejs-electron');
const {MicaBrowserWindow, IS_WINDOWS_11} = require('mica-electron');
const { pipeline } = require('stream');

const background = IS_WINDOWS_11 ? 'micaActive' : 'bg-dark';

const __main = path.resolve(__dirname);
const __data = path.resolve(app.getPath('documents'));
const __static = path.resolve(__dirname+"/static");


const Logs = new _Logs(
	false,
	'HomeStudioLogging',
	path.join(__data, 'HomeStudioData'),
	'D',
	false
)
const Config = new _Config(
	Logs
);
const Server = new _Server(
	expressRoutes,
	Logs,
	version,
	Config,
	doMessage,
	()=>{},
	fs.readFileSync(path.join(__dirname,'./cert/key.pem')),
	fs.readFileSync(path.join(__dirname,'./cert/cert.pem'))
);

ejse.data('static',  __static);
ejse.data('background',  background);


let isQuiting = false;
let mainWindow = null;
let configLoaded = false;
let pipelines = [];

/* Start App */

['exit','SIGINT','SIGUSR1','SIGUSR2'].forEach(type => process.on(type, exitHandler));
process.on('uncaughtException', error => exitHandler(true, error));

(async () => {

	app.commandLine.appendSwitch('ignore-certificate-errors');
	app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

	await app.whenReady();
	await setUpApp();
	await createWindow();

	{ /* Config */
		Logs.printHeader('HomeStudio');
		Config.require('host', [], 'What is the IP/host of this machine');
		Config.require('port', [], 'What port shall the server use');
		Config.require('portSSL', [], 'What port shall the server use for SSL');
		Config.require('systemName', [], 'What is the name of the system/job');
		Config.require('defaultLayout', {'thumnail': 'Thumnails Only', 'basic':'Basic Presets','advanced': 'Advanced With Editor'}, 'What should the default view be when a user connects');
		Config.require('allowLowres', {true: 'Yes', false: 'No'}, 'Generate lowres proxys for small pips');
		Config.require('allowSearch', {true: 'Yes', false: 'No'}, 'Enable search for long thumbnail lists');
		Config.require('reconnectTimeoutSeconds', [], 'How long should a stream wait before trying to reconnect in the GUI');
		Config.require('loggingLevel', {'A':'All', 'D':'Debug', 'W':'Warnings', 'E':'Errors'}, 'Set logging level:');
		Config.require('createLogFile', {true: 'Yes', false: 'No'}, 'Save Logs to local file');
		Config.require('advancedConfig', {true: 'Yes', false: 'No'}, 'Show advanced config settings');
		{
			Config.require('debugLineNum', {true: 'Yes', false: 'No'}, 'Print line numbers?', ['advancedConfig', true]);
			Config.require('printPings', {true: 'Yes', false: 'No'}, 'Print pings?', ['advancedConfig', true]);
			Config.require('devMode', {true: 'Yes', false: 'No'}, 'Dev mode - Disables connections to devices', ['advancedConfig', true]);
		}

		Config.default('port', 8080);
		Config.default('portSSL', 443);
		Config.default('systemName', 'Home Studio');
		Config.default('loggingLevel', 'W');
		Config.default('homestudioKey', '');
		Config.default('defaultLayout', 'basic');
		Config.default('allowLowres', true);
		Config.default('allowSearch', true);
		Config.default('createLogFile', true);
		Config.default('debugLineNum', false);
		Config.default('printPings', false);
		Config.default('advancedConfig', false);
		Config.default('devMode', false);
		Config.default('homestudioKey', '');
		Config.default('host', 'localhost');
		Config.default('reconnectTimeoutSeconds', 4);


		if (!await Config.fromFile(path.join(__data, 'HomeStudioData', 'config.conf'))) {
			await Config.fromAPI(path.join(app.getPath('documents'), 'HomeStudioData', 'config.conf'), configQuestion, configDone);
		}

		if (Config.get('loggingLevel') == 'D' || Config.get('loggingLevel') == 'A') {
			Config.set('debugLineNum', true);
		}
		
		Logs.setConf({
			createLogFile: Config.get('createLogFile'),
			logsFileName: 'HomeStudioLogging',
			configLocation: path.join(__data, 'HomeStudioData'),
			loggingLevel: Config.get('loggingLevel'),
			debugLineNum: Config.get('debugLineNum')
		})

		Logs.log('Running version: v'+version, ['H', 'SERVER', Logs.g]);
		Logs.log(`Logging to: ${path.join(__data, 'HomeStudioData', 'Logs')}`, ['H', 'SERVER', Logs.g]);
		Logs.log(`Config saved to: ${path.join(__data, 'HomeStudioData', 'config.conf')}`, ['H', 'SERVER', Logs.g]);
		Config.print();
		Config.userInput(async command => {
			switch (command) {
			case 'config':
				await Config.fromCLI(path.join(__data, 'HomeStudioData', 'config.conf'));
				if (Config.get('loggingLevel') == 'D' || Config.get('loggingLevel') == 'A') {
					Config.set('debugLineNum', true);
				}
				Logs.setConf({
					'createLogFile': Config.get('createLogFile'),
					'LogsFileName': 'HomeStudioLogging',
					'configLocation': path.join(__data, 'HomeStudioData'),
					'loggingLevel': Config.get('loggingLevel'),
					'debugLineNum': Config.get('debugLineNum')
				});
				return true;
			}
		});
		configLoaded = true;
	}

	Logs.log(`${Config.get('systemName')} can be accessed at http://${Config.get('host')}:${Config.get('port')}`, ['H', 'SERVER', Logs.g]);

	//Server.start(Config.get('port'), Config.get('portSSL'));
	Server.start(Config.get('port'));
	mainWindow.webContents.send('loaded', `http://localhost:${Config.get('port')}/app`);
	//mainWindow.webContents.send('loaded', `https://localhost:${Config.get('portSSL')}/app`);
	const Decoders = decoders()
	for (let index = 0; index < Decoders.length; index++) {
		const decoder = Decoders[index];
		//startPush(decoder.ID);
		//await sleep(0.2);
	}
	startSignalling();
	startPipelines();
	startThumbWatch();
	//setInterval(getPush, 10*1000);
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
			Config.fromAPI(path.join(app.getPath('documents'), 'HomeStudioData','config.conf'), configQuestion, configDone);
			break;
		case 'stop':
			Logs.log('Not implemeneted yet: Cancle config change');
			break;
		case 'show':
			Config.print();
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

	Logs.on('logSend', message => {
		try {
			if (!isQuiting) mainWindow.webContents.send('log', message);
		} catch (error) {
			
		}
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
				//mainWindow.webContents.send('loaded', `https://localhost:${Config.get('portSSL')}/app`);
				mainWindow.webContents.send('loaded', `http://localhost:${Config.get('port')}/app`);
			}
			resolve();
		});
	});
}

async function exitHandler(crash, error) {
	shuttingDown = true;
	if (crash) Logs.error('Uncaught error has caused a crash', error);
	try {
		new _Shell(Logs, 'ERROR', 'E').runSync('killall -9 gst-launch-1.0');
	} catch (error) {
		
	}
	try {
		new _Shell(Logs, 'ERROR', 'E').runSync('killall -9 gst-webrtc-signalling-server');
	} catch (error) {
		
	}
	process.exit();
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
	Logs.setConf({
		'createLogFile': Config.get('createLogFile'),
		'LogsFileName': 'ArgosLogging',
		'configLocation': path.join(app.getPath('documents'), 'ArgosData'),
		'loggingLevel': Config.get('loggingLevel'),
		'debugLineNum': Config.get('debugLineNum'),
	});
	if (configLoaded) mainWindow.webContents.send('loaded', `http://localhost:${Config.get('port')}/app`);
	if (Config.get('localDataBase')) {
		SQL = new SQLSession(
			Config.get('dbHost'),
			Config.get('dbPort'),
			Config.get('dbUser'),
			Config.get('dbPass'),
			Config.get('dbName'),
			Logs
		);
		await SQL.init(tables);
	}
}


/* Video */


function newPipeline(input, outputs, ID) {
	let command = `webrtcsink name=ws meta="meta,name=${ID}" `;
	switch (input.type) {
		case 'SDI':
			command += `decklinkvideosrc device-number=${input.connector} mode=${input.format} `
			break;
		case 'SRT':
			command += `srtsrc uri="${input.url}" ! decodebin `
			break;
		default:
			break;
	}
	command += `! videoconvert ! tee name=t \\\n`;
	command += `t. ! queue ! ws. \\\n`;
	command += `t. ! queue ! videorate ! videoscale ! video/x-raw,height=216,width=384,framerate=1/5 ! jpegenc ! multifilesink location=/home/nep/HomeStudio-Remote/static/thumbnailsRaw/${ID}_thumb_%d.jpeg \\\n`;
	outputs.forEach(output => {
		switch (output.type) {
			case 'SDI':
				command += `t. ! queue ! videoconvert ! decklinkvideosink device-number=${output.connector} mode=${output.format} \\\n`
				break;
			case 'SRT':
				command += `t. ! queue ! videoconvert ! x264enc tune=zerolatency ! video/x-h264, profile=high ! mpegtsmux ! srtsink uri=${output.url} \\\n`
				break;
			default:
				break;
		}
	})
	return new _Pipeline(Logs, command);
}


function startPipelines() {
	encoders('SDI').forEach(encoder => {
		const input = {
			'type':'SDI',
			'connector': encoder.URL,
			'format': '1080p25'
		};
		const outputs = [];
		if (encoder.OutPort) {
			outputs.push({
				'type': 'SDI',
				'connector': encoder.OutPort,
				'format': '1080p25'
			})
		}
		if (encoder.OutURL) {
			outputs.push({
				'type': 'SRT',
				'url': encoder.OutURL
			})
		}
		Logs.object(outputs);
		const SDI = newPipeline(input, outputs, String(encoder.ID));
		pipelines.push(SDI);
		SDI.on('playing', ()=>Logs.log(`${encoder.Name} is playing`));
		SDI.on('stdout', message => Logs.debug(message));
		SDI.on('stopped', ()=>pipelines.splice(pipelines.indexOf(SDI),1));
		SDI.start();
	})
	encoders('SRT').forEach(encoder => {
		const input = {
			'type':'SRT',
			'url': encoder.URL
		};
		const outputs = [];
		if (encoder.OutPort) {
			outputs.push({
				'type': 'SDI',
				'connector': encoder.OutPort,
				'format': '1080p25'
			})
		}
		if (encoder.OutURL) {
			outputs.push({
				'type': 'SRT',
				'url': encoder.OutURL
			})
		}
		Logs.object(outputs);
		const SRT = newPipeline(input, outputs, String(encoder.ID));
		pipelines.push(SRT);
		SRT.on('playing', ()=>Logs.log(`${encoder.Name} is playing`));
		SRT.on('stdout', message => Logs.debug(message));
		SRT.on('stopped', ()=>pipelines.splice(pipelines.indexOf(SRT),1));
		SRT.start();
	})
}

function startSignalling() {
	const Shell = new _Shell(Logs, 'SIGNAL', 'D');
	const signalServer = Shell.process('cd ~/gst-plugins-rs/net/webrtc/signalling && WEBRTCSINK_SIGNALLING_SERVER_LOG=debug cargo run --bin gst-webrtc-signalling-server', false);
	signalServer.on('stdout', doLog);
	signalServer.on('stderr', doLog);
	function doLog(output) {
		const outputArray = output.split('\n');
		outputArray.forEach(stdout => {
			if (stdout.includes('INFO')) Logs.info(stdout.split('INFO')[1]);
			else if (stdout.includes('DEBUG')) Logs.info(stdout.split('DEBUG')[1]);
			else if (stdout.includes('WARN')) Logs.warn(stdout.split('WARN')[1]);
			else if (stdout.includes('WRROR')) Logs.error(stdout.split('WRROR')[1]);
			else Logs.log(stdout, ['D', 'SIGNAL', Logs.c]);
		});
	}
}

function startThumbWatch() {
	const thumbPath = './static/thumbnailsRaw';
	fs.watch(thumbPath, (eventType, filename) => {
		if (eventType != 'rename') return;
		if (filename.split('.').length < 3) {
			const oldPath = `${thumbPath}/${filename}`;
			const newPath = `./static/thumbnails/${filename.split('_thumb_')[0]}_thumb.jpeg`;
			fs.rename(oldPath, newPath, error => {
				if (!error) Logs.info(`Successfully renamed '${filename}' - AKA moved!`)
			})
		}
	})
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
		systemName: Config.get('systemName'),
		version: version,
		homestudioKey: Config.get('homestudioKey'),
		encoders: encoders(),
		decoders: decoders(),
		layouts: layouts(),
		host: Config.get('host'),
		reconnectTimeoutSeconds: Config.get('reconnectTimeoutSeconds'),
		allowLowres: Config.get('allowLowres'),
		allowSearch: Config.get('allowSearch'),
		background: background
	}}

	expressApp.get('/',  (req, res) =>  {
		Logs.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = Config.get('defaultLayout');
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/config',  (req, res) =>  {
		Logs.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = true;
		homeOptions.layout = "thumbnail";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/advanced',  (req, res) =>  {
		Logs.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = "advanced";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/basic',  (req, res) =>  {
		Logs.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = "basic";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/thumbnails',  (req, res) =>  {
		Logs.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = false;
		homeOptions.layout = "thumbnail";
		homeOptions.inApp = false;
		res.render('home', homeOptions);
	});
	expressApp.get('/app',  (req, res) =>  {
		Logs.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const homeOptions = getHomeOptions();
		homeOptions.config = true;
		homeOptions.layout = "thumbnail";
		homeOptions.inApp = true;
		res.render('home', homeOptions);
	});
	expressApp.get('/about',  async (req, res) =>  {
		Logs.log('New client connected', 'A');
		res.header('Content-type', 'text/html');
		const aboutInfo = {
			'aboutInfo': {
				'Version': version,
				'Config': Config.all(),
				'Layouts': layouts(),
				'Encoders': encoders(),
				'Decoders': decoders()
			},
			'systemName': Config.get('systemName')
		}
		res.render('about', aboutInfo);
	});

	expressApp.get('/getConfig', (req, res) => {
		Logs.log('Request for devices config', 'D');
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
		//getPush();
	});

	expressApp.post('/setencoders', (req, res) => {
		Logs.log('Request to set encoders config data', 'D');
		Server.sendToAll({
			"command":"feeds",
			"feeds":req.body
		});
		writeData('Encoders', req.body);
		res.send('Done');
		pipelines.forEach(pipeline => pipeline.stop());
		startPipelines();
	});
	expressApp.post('/setdecoders', (req, res) => {
		Logs.log('Request to set decoders config data', 'D');
		writeData('Decoders', req.body);
		res.send('Done');
	});
	expressApp.post('/setlayouts', (req, res) => {
		Logs.log('Request to set layouts config data', 'D');
		Server.sendToAll({
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
		Config.set('homestudioKey', payload.key);
		break;
	case 'register':
		Logs.log('Client registered', 'A');
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
		Logs.log(`Cloud not read the file ${file}.json, attempting to create new file`, 'W');
		Logs.debug('File error:', error);
		let fileData = [];
		switch (file) {
		case 'Encoders':
			fileData[0] = {
				'Name':'Camera 1',
				'ID':1,
				'Type':'Local Encoder',
				'URL':'wss://IPAddress:3333/app/feed1',
				'OutPort':1,
				'OutURL':'srt://IPAddress:9000'
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
	Logs.debug(`Sending push request to: http://${Config.get('host')}:8081/v1/vhosts/default/apps/app:startPush`);
	try {
		const response = await fetch(`http://${Config.get('host')}:8081/v1/vhosts/default/apps/app:startPush`,{
			method: 'POST',
			headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')},
			body: JSON.stringify(body)
		})
		const jsonRpcResponse = await response.json();
		if (response.status !== 200) {
			Logs.warn('Could not reach OME server', response.statusText);
			Server.sendToAll({
				"command": "log",
				"type": "decoding",
				"message": `Error pushing stream: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
			});
			return;
		}
		Server.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Started pushing stream: <pre <pre class="d-none" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
		});
		return jsonRpcResponse;
	} catch (error) {
		Logs.warn('Could not reach OME server', error);
		Server.sendToAll({
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
	Logs.debug(`Sending push request to: http://${Config.get('host')}:8081/v1/vhosts/default/apps/app:stopPush`);
	try {
		const response = await fetch(`http://${Config.get('host')}:8081/v1/vhosts/default/apps/app:stopPush`,{
			method: 'POST',
			headers: {"Authorization": "Basic "+Buffer.from("admin:NEPVisions!").toString('base64')},
			body: JSON.stringify(body)
		})
		const jsonRpcResponse = await response.json();
		if (response.status !== 200) {
			Logs.warn('Could not reach OME server', response.statusText);
			Server.sendToAll({
				"command": "log",
				"type": "decoding",
				"message": `Error stopping stream: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
			});
			return;
		}
		Server.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Stopped pushing stream: <pre class="d-none" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
		});
		return jsonRpcResponse;	
	} catch (error) {
		Logs.warn('Could not reach OME server', error);
		Server.sendToAll({
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
	Logs.log(`Getting pushes from to: http://${Config.get('host')}:8081/v1/vhosts/default/apps/app:pushes`, 'A');
	try {
		const response = await fetch(`http://${Config.get('host')}:8081/v1/vhosts/default/apps/app:pushes`, postOptions)
		const jsonRpcResponse = await response.json();
		if (response.status !== 200) {
			Logs.warn('Could not reach OME server', response.statusText);
			Server.sendToAll({
				"command": "log",
				"type": "decoding",
				"message": `Error getting pushes: ${response.statusText}: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(jsonRpcResponse, null, 4)}</pre>`
			});
			return;
		}
		Server.sendToAll({
			"command": "log",
			"type": "pushStatus",
			"message": jsonRpcResponse
		});
		return jsonRpcResponse;
	} catch (error) {
		Logs.warn('Could not reach OME server', error);
		Server.sendToAll({
			"command": "log",
			"type": "decoding",
			"message": `Error getting pushes cannot connect to server: <pre class="bg-secondary card p-1 px-2 mt-2" style="white-space: break-spaces;">${JSON.stringify(error, null, 4)}</pre>`
		});
		return;
	}
}