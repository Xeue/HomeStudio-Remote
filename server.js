/* eslint-disable no-unused-vars */
//const fetch = require('node-fetch');
const fs = require('fs');
const express = require('express');
const path = require('path');
const {log, logObj, logs, logEvent} = require('xeue-logs');
const {config} = require('xeue-config');
const {Server} = require('xeue-webserver');
const {version} = require('./package.json');

let webServer;
const __main = path.resolve(__dirname);
const __data = path.resolve(__dirname);
const __static = path.resolve(__dirname+"/static");


/* Start App */

(async () => {
	{ /* Config */
		logs.printHeader('HomeStudio');
		config.useLogger(logs);
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

		if (!await config.fromFile(path.join(__data, 'HomeStudioData', 'config.conf'))) {
			await config.fromCLI(path.join(__data, 'HomeStudioData', 'config.conf'));
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
})().catch(error => {
	console.log(error);
});

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
			streams: streams()
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
				'Name':'Feed',
				'Type':'Local',
				'URL':'wss://srt01.nep.group/APP/STREAM',
				'Port':9000
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