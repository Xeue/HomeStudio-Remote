import EventEmitter from 'events';
import {Shell as _Shell} from 'xeue-shell';

export default class Pipeline extends EventEmitter {
	constructor(
		Logs, command
	) {
        super();
        this.Logs = Logs;
        this.command = command;
        this.process;
        this.state = 'stopped';
        this.active = false;
        this.killed = false;
        this.on('internalState', state => {
            if (state == 'stopped' && this.state == 'stopped') return;
            if (state == 'feedActive' && this.active) return;
            else if (state == 'feedActive' && !this.active) this.active = true;
            this.state = state;
            this.emit(state);
        })
	}

    start() {
        if (this.killed) return;
        const Shell = new _Shell(this.Logs, 'GSTRMR', 'D');
        this.process = Shell.process('gst-launch-1.0 '+this.command, false);
        this.process.on('stdout', stdout => this.#checkOut(stdout));
        this.process.on('stderr', stderr => this.#checkOut(stderr));
        this.process.on('error', error => this.Logs.error(error));
        this.process.on('exit', () => this.emit('internalState', 'stopped'));
    }

    stop() {
        this.active = false;
        this.process.kill();
        this.emit('internalState', 'stopped');
    }

    kill() {
        this.active = false;
        this.killed = true;
        this.process.kill('SIGINT');
        this.emit('internalState', 'killed');
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
            if (line.includes('Redistribute latency')) this.emit('internalState', 'feedActive');
            if (line.includes('Freeing pipeline')) this.stop();
        });
        this.emit('stdout', output);
    }

}

async function sleep(seconds) {
	await new Promise (resolve => setTimeout(resolve, 1000*seconds));
}