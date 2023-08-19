/*jshint esversion: 6 */

class webSocket extends EventTarget {
	constructor(serverURL, type, clientVersion, currentSystem, ssl = false, logger = console) {
		super();
		this.loadTime = new Date().getTime();
		this.clientID = `${type.charAt(0)}_${this.loadTime}_${clientVersion}`;
		this.version = clientVersion;
		this.type = type;

		this.connecting = false;
		this.server;
		this.forceShut = false;
		this.serverURL = serverURL;
		this.protocol = 'ws';
		this.currentSystem = currentSystem;
		this.logger = logger;
		this.timeout;
		this.timeoutCounter = 0;

		if (ssl) {
			this.protocol = 'wss';
		}
		this.connect(this.serverURL);
	}

	connect(serverURL) {
		clearTimeout(this.timeout);
		if (this.serverURL !== serverURL) {
			if (typeof this.server !== 'undefined') {
				this.server.close();
			}
			this.server = null;
			this.serverURL = serverURL;
			this.connecting = false;
		}
		if (this.connecting) {
			if (this.timeoutCounter > 4) {
				this.timeoutCounter = 0;
				this.logger.log('Terminating hung connection');
				this.server.close();
				this.server = null;
				this.serverURL = serverURL;
				this.connecting = false;
				this.connect(this.serverURL);
			} else {
				this.timeoutCounter++;
				this.timeout = setTimeout(() => {
					this.logger.log('Waiting for connection');
					this.connect(this.serverURL);
				}, 500);
				return this.server;
			}
		}
		this.connecting = true;
		this.logger.log(`Connecting to: ${this.protocol}://${this.serverURL}`);
		this.server = new WebSocket(`${this.protocol}://${this.serverURL}`);

		this.server.onopen = event => {
			clearTimeout(this.timeout);
			this.timeoutCounter = 0;
			this.logger.log('Connection established!');
			this.connecting = false;
			this.dispatchEvent(new Event('open'));
		};

		this.server.onmessage = event => {
			const packet = JSON.parse(event.data);
			const header = packet.header;
			const payload = packet.payload;
			switch (payload.command) {
			case 'ping':
				this.send({'command':'pong'});
				this.dispatchEvent(new Event('ping'));
				break;
			default:
				this.dispatchEvent(new CustomEvent('message', {detail: [header, payload, event]}));
				break;
			}
		};

		this.server.onclose = () => {
			if (this.forceShut) {
				this.logger.log('Connection forcably ended');
			} else {
				this.logger.log('Connection ended');
				this.timeout = setTimeout(() => {
					this.logger.log('Reconnecting');
					this.connect(this.serverURL);
				}, 2000);
			}
			this.forceShut = false;
			this.dispatchEvent(new Event('close'));
		};

		this.server.disconnect = () => {
			this.forceShut = true;
			this.server.close();
			this.dispatchEvent(new Event('disconnect'));
		};

		this.server.onerror = event => {
			this.dispatchEvent(new CustomEvent('error', {detail: [event]}));
		}

		return this.server;
	}

	makeHeader() {
		const header = {
			'fromID': this.clientID,
			'timestamp': new Date().getTime(),
			'version': version,
			'type': this.type,
			'system': this.currentSystem,
			'active': false,
		};
		if (this.connecting == 0) {
			header.active = true;
		}
		header.messageID = header.timestamp;
		return header;
	}

	send(payload) {
		this.server.send(JSON.stringify({
			'header': this.makeHeader(),
			'payload': payload
		}));
	}

	close() {
		this.forceShut = true;
		this.server.close();
		this.dispatchEvent(new Event('close'));
	}

	setSystem(system) {
		this.currentSystem = system;
	}
}