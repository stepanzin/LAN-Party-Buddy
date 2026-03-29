import midi from '@julusian/midi';
import * as O from 'fp-ts/Option';
import * as R from 'fp-ts/Record';
import { pipe } from 'fp-ts/function';

import {DEVICE_NAME, RULES} from './lib/config';
import {select} from "@inquirer/prompts";

const input = new midi.Input();
const output = new midi.Output();

const devices = Array.from({ length: input.getPortCount() }).map((_, i) => ({
    value: i,
    name: input.getPortName(i),
}));

const id = await select({
    message: 'Select MIDI input devices to open:',
    choices: devices,
})

input.openPort(id);

output.openVirtualPort(DEVICE_NAME);

let prevCode: number | null = null;
input.on('message', (_: number, message: readonly number[]) => {
    const [status, cc, value] = message;

    if (!status || !cc || !value) return;

    const mapper = pipe(
        RULES,
        R.lookup(cc.toString()),
    );

    if (cc === 49) {
        output.send([status, 99, 0]);
        output.send([status, 100, 127]);
    } else {
        output.send([status, 99, 127]);
        output.send([status, 100, 0]);
    }

    let mappedValue = value;
    if (O.isSome(mapper)) {
        mappedValue = mapper.value(value);
    } else {
        if (prevCode !== null) {
            output.send([status, prevCode, 0])
        }

        prevCode = cc;
    }

    console.log(`CC: ${cc} Value: ${value} -> ${mappedValue}`);

    output.send([status, cc, mappedValue]);
});

// Ожидание прерывания, чтобы процесс не завершался сразу
process.stdin.resume();


console.log(`\nProxying MIDI signals -> ${DEVICE_NAME}\n\nPress Ctrl+C to exit`);

// Грейсфул-выход: закрываем порты и выходим
const shutdown = () => {
    console.log('Shutting down MIDI mapper...');
    try {
        // Закрываем входной порт, если открыт
        if (typeof input.closePort === 'function') {
            input.closePort();
        }
    } catch (e: any) {
        console.error('Error closing input port:', e?.message ?? e);
    }

    try {
        if (typeof output.closePort === 'function') {
            output.closePort();
        }
    } catch (e: any) {
        console.error('Error closing output port:', e?.message ?? e);
    }

    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

