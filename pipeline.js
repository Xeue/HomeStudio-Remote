const EventEmitter = require('events');
const _Shell = require('xeue-shell').Shell;

class Pipeline extends EventEmitter {
	constructor(
		Logs, command
	) {
        super();
        this.Logs = Logs;
        this.command = command;
        this.process;
        this.state = 'stopped';
        this.on('internalState', state => {
            if (state == 'exit' && this.state == 'stopped') return;
            this.state = state;
            this.emit(state);
        })
	}

    start() {
        const Shell = new _Shell(this.Logs, 'GSTRMR', 'D');
        this.process = Shell.process('gst-launch-1.0 '+this.command, false);
        this.process.on('stdout', stdout => this.#checkOut(stdout));
        this.process.on('stderr', stderr => this.#checkOut(stderr));
        this.process.on('error', error => this.Logs.error(error));
        this.process.on('exit', () => this.emit('internalState', 'exit'));
    }

    stop() {
        this.emit('internalState', 'stopped');
        this.process.kill();
    }

    async restart() {
        this.stop();
        await sleep(0.5);
        this.start();
    }

    update(command) {
        this.command = command;
        this.restart();
    }

    #checkOut(output) {
        const lines = output.split('\n')
        lines.forEach(line => {
            if (line.includes('PAUSED')) this.emit('internalState', 'paused');
            if (line.includes('PREROLLED')) this.emit('internalState', 'prerolled');
            if (line.includes('PLAYING')) this.emit('internalState', 'playing');
        });
        this.emit('stdout', output);
    }

}

async function sleep(seconds) {
	await new Promise (resolve => setTimeout(resolve, 1000*seconds));
}

module.exports.Pipeline = Pipeline;