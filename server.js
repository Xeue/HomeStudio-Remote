/* eslint-disable no-unused-vars */
import fs from 'fs';
import path from 'path';
import express from 'express';
import {homedir} from 'os';
import {Logs as _Logs} from 'xeue-logs';
import {Config as _Config} from 'xeue-config';
import {Server as _Server} from 'xeue-webserver';
import {Shell as _Shell} from 'xeue-shell';
import _Pipeline from './pipeline.js';
import Package from './package.json' assert {type: "json"};
import _TSL5 from 'tsl-umd-v5';

const version = Package.version;
const __dirname = path.resolve(path.dirname(decodeURI(new URL(import.meta.url).pathname))).replace('C:\\','');
const __data = path.join(homedir(), 'Documents', 'HomeStudioData');
const __static = path.resolve(__dirname+"/static");

const UMD = new _TSL5();
const Logs = new _Logs(
	false,
	'HomeStudioLogging',
	__data,
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

let pipelines = [];

/* Start App */

process.stdin.resume();
['exit','SIGINT','SIGUSR1','SIGUSR2'].forEach(type => process.on(type, exitHandler));
process.on('uncaughtException', error => exitHandler(true, error));

{ /* Config */
	Logs.printHeader('HomeStudio');
	Config.require('host', [], 'What is the IP/host of this machine');
	Config.require('port', [], 'What port shall the server use');
	Config.require('portSSL', [], 'What port shall the server use for SSL');
	Config.require('systemName', [], 'What is the name of the system/job');
	Config.require('trebmalAddress', [], 'Address for Trebmal reverse playback audio');
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
	Config.default('trebmalAddress', 'localhost:8081');
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


	if (!await Config.fromFile(path.join(__data, 'config.conf'))) {
		await Config.fromCLI(path.join(__data, 'config.conf'));
	}

	if (Config.get('loggingLevel') == 'D' || Config.get('loggingLevel') == 'A') {
		Config.set('debugLineNum', true);
	}
	
	Logs.setConf({
		createLogFile: Config.get('createLogFile'),
		logsFileName: 'HomeStudioLogging',
		configLocation: __data,
		loggingLevel: Config.get('loggingLevel'),
		debugLineNum: Config.get('debugLineNum')
	})

	Logs.log('Running version: v'+version, ['H', 'SERVER', Logs.g]);
	Logs.log(`Logging to: ${path.join(__data, 'Logs')}`, ['H', 'SERVER', Logs.g]);
	Logs.log(`Config saved to: ${path.join(__data, 'config.conf')}`, ['H', 'SERVER', Logs.g]);
	Config.print();
	Config.userInput(async command => {
		switch (command) {
		case 'config':
			await Config.fromCLI(path.join(__data, 'config.conf'));
			if (Config.get('loggingLevel') == 'D' || Config.get('loggingLevel') == 'A') {
				Config.set('debugLineNum', true);
			}
			Logs.setConf({
				'createLogFile': Config.get('createLogFile'),
				'LogsFileName': 'HomeStudioLogging',
				'configLocation': __data,
				'loggingLevel': Config.get('loggingLevel'),
				'debugLineNum': Config.get('debugLineNum')
			});
			return true;
		}
	});
}

Logs.log(`${Config.get('systemName')} can be accessed at http://${Config.get('host')}:${Config.get('port')}`, ['H', 'SERVER', Logs.g]);

//Server.start(Config.get('port'), Config.get('portSSL'));
Server.start(Config.get('port'));

clearProcesses();
const signalServer = startSignalling();
await sleep(1);
Logs.log(`Singalling server has been started`, ['H', 'SERVER', Logs.g]);
startPipelines();
Logs.log(`Pipelines created`, ['H', 'SERVER', Logs.g]);
startThumbWatch();
Logs.log(`Thumbnail watcher started`, ['H', 'SERVER', Logs.g]);
//setInterval(getPush, 10*1000);

try {
	UMD.listenUDP(8901);
	UMD.listenTCP(8903);
} catch (error) {
	Logs.warn('TSL tally could not be started, port in use', error);
}

UMD.on('message', data => {
	const breakpoint = /(\\.*?){6}u0000/;
	const rawumds = JSON.stringify(data.display.text.replace('"','')).split(breakpoint);
	const umds = rawumds.filter(umd => umd != '\\').map(umd => umd.replace('\"', ''));
	const encodersData = encoders();
	const umdIndex = data.index;
	encodersData.forEach(encoder => {
		if (encoder.Type != "SDI") return;
		if ((encoder.URL - umdIndex) < 0) return;
		if (umds.length < (encoder.URL - umdIndex)) return;
		encoder.Name = umds[encoder.URL - umdIndex];
	})
	const feeds = [];
	encodersData.forEach(encoder => {
		if (encoder.Type != "SDI") return;
		feeds.push({
			"Name": encoder.Name,
			"ID": encoder.ID
		})
	})
	const payload = {
		"command":"rename",
		"feeds": feeds
	}
	Server.sendToAll(payload);
	writeData('Encoders', encodersData);
});




async function exitHandler(crash, error) {
	Logs.log('Shutting down processes', ['C', 'EXIT', Logs.r]);
	if (crash) Logs.error('Uncaught error has caused a crash', error);
	clearProcesses();
	process.exit();
}

function clearProcesses() {
	try {
		pipelines.forEach(pipeline => pipeline.kill());
		new _Shell(Logs, 'ERROR', 'E').runSync('killall -9 gst-launch-1.0');
	} catch (error) {
		//Logs.error(error)
		Logs.debug('No GST running');
	}
	try {
		signalServer.kill();
		new _Shell(Logs, 'ERROR', 'E').runSync('killall -9 gst-webrtc-signalling-server');
	} catch (error) {
		//Logs.error(error)
		Logs.debug('No signaler running');
	}
}


/* Video */


function newPipeline(input, outputs, ID) {
	let command = `webrtcsink name=ws meta="meta,name=${ID}" turn-servers="\<\"turn:10.201.0.88:3478\"\>" `;
	switch (input.type) {
		case 'SDI':
//			command += `decklinkvideosrc device-number=${input.connector} mode=${input.format} `
			command += `decklinkvideosrc device-number=${input.connector} skip-first-time=1000000000 ! tee name=videot \\\n`
			break;
		case 'SRT':
			command += `srtsrc uri="${input.url}" ! decodebin ! tee name=videot \\\n`
			break;
		default:
			break;
	}
	//command += `! videoconvert ! tee name=t \\\n`;
	command += `videot. ! queue ! videoconvert ! videoscale ! video/x-raw,height=720,width=1280 ! vp8enc deadline=1 target-bitrate=2000000 ! ws. \\\n`;
	//command += `videot. ! queue ! videoconvert ! vp8enc deadline=1 target-bitrate=2000000 ! ws. \\\n`;
	//command += `videot. ! queue ! videoconvert ! ws. \\\n`;
	command += `videot. ! queue ! videoconvert ! videorate ! videoscale ! video/x-raw,height=216,width=384,framerate=1/5 ! jpegenc ! multifilesink location=/home/nep/HomeStudio-Remote/static/thumbnailsRaw/${ID}_thumb_%d.jpeg \\\n`;
	outputs.forEach(output => {
		switch (output.type) {
			case 'SDI':
				command += `videot. ! queue ! videoconvert ! decklinkvideosink device-number=${output.connector} mode=${output.format} \\\n`
				break;
			case 'SRT':
				command += `videot. ! queue ! videoconvert ! x264enc tune=zerolatency ! video/x-h264, profile=high ! mpegtsmux ! srtsink uri=${output.url} \\\n`
				break;
			default:
				break;
		}
	})
	Logs.info(`Running: ${command}`);
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
		SDI.on('playing', ()=>Logs.log(`${encoder.Name} is active`, ['C', 'SDISRC', Logs.g]));
		SDI.on('feedActive', ()=>Logs.log(`${encoder.Name} is recieving SDI`, ['C', 'SDISRC', Logs.g]));
		SDI.on('stdout', message => Logs.log(message, ['D', 'SDISRC', Logs.c]));
		SDI.on('stopped', ()=> {
			Logs.log(`${encoder.Name} has stopped recieving SDI`, ['C', 'SDISRC', Logs.y]);
			if (!SDI.killed) SDI.restart();
		})
		SDI.on('killed', ()=> {
			Logs.log(`${encoder.Name} has been killed`, ['C', 'SDISRC', Logs.r]);
			pipelines.splice(pipelines.indexOf(SDI),1);
		})
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
		SRT.on('playing', ()=>Logs.log(`${encoder.Name} is active`, ['C', 'SRTSRC', Logs.g]));
		SRT.on('feedActive', ()=>Logs.log(`${encoder.Name} is recieving SRT`, ['C', 'SRTSRC', Logs.g]));
		SRT.on('stdout', message => Logs.log(message, ['D', 'SRTSRC', Logs.c]));
		SRT.on('stopped', ()=> {
			Logs.log(`${encoder.Name} has stopped recieving SRT`, ['C', 'SRTSRC', Logs.y]);
			if (!SRT.killed) SRT.restart();
		})
		SRT.on('killed', ()=> {
			Logs.log(`${encoder.Name} has been killed`, ['C', 'SRTSRC', Logs.r]);
			pipelines.splice(pipelines.indexOf(SRT),1);
		})
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
	return signalServer;
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

function layouts(id) {
	const Layouts = loadData('Layouts');
	if (id !== undefined) return Layouts.filter(layout => layout.ID == id);
	return Layouts;
}

function expressRoutes(expressApp) {
	expressApp.set('views', path.join(__dirname, 'views'));
	expressApp.set('view engine', 'ejs');
	expressApp.use(express.json());
	expressApp.use(express.static(__static));

	function getHomeOptions() {return {
		systemName: Config.get('systemName'),
		version: version,
		homestudioKey: Config.get('homestudioKey'),
		encoders: encoders(),
		layouts: layouts(),
		host: Config.get('host'),
		reconnectTimeoutSeconds: Config.get('reconnectTimeoutSeconds'),
		allowLowres: Config.get('allowLowres'),
		allowSearch: Config.get('allowSearch'),
		trebmalAddress: Config.get('trebmalAddress')
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
				'Encoders': encoders()
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
		case 'layouts':
			data = layouts();
			break;
		default:
			break;
		}
		res.send(JSON.stringify(data));
		//getPush();
	});

	expressApp.get('/trebRec',  (req, res) => {
		Server.sendToAll({
			"command":"trebRec"
		});
		res.send('yes');
	});

	expressApp.get('/trebClip',  (req, res) => {
		Server.sendToAll({
			"command":"trebClip"
		});
		res.send('yes');
	});

	expressApp.get('/trebPlay',  (req, res) => {
		Server.sendToAll({
			"command":"trebPlay"
		});
		res.send('yes');
	});

	expressApp.get('/trebDone',  (req, res) => {
		Server.sendToAll({
			"command":"trebDone"
		});
		res.send('yes');
	});

	expressApp.post('/setencoders', async (req, res) => {
		Logs.log('Request to set encoders config data', 'D');
		Server.sendToAll({
			"command":"feeds",
			"feeds":req.body
		});
		writeData('Encoders', req.body);
		res.send('Done');
		const Shell = new _Shell(Logs, 'KILLER', 'W');
		Shell.runSync('killall -9 gst-launch-1.0');
		await sleep(1);
		process.exit();
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
	case 'trebmal':
		Logs.log(`Sending GET to http://${Config.get('trebmalAddress')}/${payload.endpoint}`);
		fetch(`http://${Config.get('trebmalAddress')}/${payload.endpoint}`);
		break;
	case 'rename':
		Server.sendToAll(payload);
		const encodersData = encoders();
		encodersData.forEach(encoder => {
			if (encoder.ID == payload.feeds[0].ID) {
				encoder.Name = payload.feeds[0].Name;
			}
		})
		writeData('Encoders', encodersData);
		break;
	default:
		logObj('Unknown message', msgObj, 'W');
	}
}

function loadData(file) {
	try {
		const dataRaw = fs.readFileSync(`${__data}/data/${file}.json`);
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
				'Type':'SRT',
				'URL':'srt://IPAddress:3333',
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
		if (!fs.existsSync(`${__data}/data/`)){
			fs.mkdirSync(`${__data}/data/`);
		}
		fs.writeFileSync(`${__data}/data/${file}.json`, JSON.stringify(fileData, null, 4));
		return fileData;
	}
}
function writeData(file, data) {
	try {
		fs.writeFileSync(`${__data}/data/${file}.json`, JSON.stringify(data, undefined, 2));
	} catch (error) {
		logObj(`Cloud not write the file ${file}.json, do we have permission to access the file?`, error, 'E');
	}
}

async function sleep(seconds) {
	await new Promise (resolve => setTimeout(resolve, 1000*seconds));
}
