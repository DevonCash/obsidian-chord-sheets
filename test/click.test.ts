/*
 * The metronome schedules beats against the audio clock, which is where seeking used to go wrong: the
 * beat it landed on was played immediately with no lead, heard as a click artifact rather than a beat.
 * These tests drive the scheduler through a stub audio context and inspect what it asked to be played.
 */

import {MetronomeClick} from "../src/metronome/click";
import {Transport} from "../src/metronome/transport";
import {parseSongMeta} from "../src/metronome/songMeta";

interface ScheduledBeat {
	frequency: number;
	startedAt: number;
	stoppedAt: number;
	/** Gain envelope as [value, time] pairs, in the order they were set. */
	envelope: [number, number][];
}

/** A stand-in for AudioContext whose clock is moved by hand. */
class StubAudioContext {
	currentTime = 0;
	state = "running";
	destination = {};
	readonly played: ScheduledBeat[] = [];
	/** The beat being built: an oscillator is created first, then the gain node shaping it. */
	private building: ScheduledBeat | null = null;

	createOscillator() {
		const beat: ScheduledBeat = {frequency: 0, startedAt: NaN, stoppedAt: NaN, envelope: []};
		this.building = beat;
		return {
			frequency: {set value(hz: number) { beat.frequency = hz; }},
			connect: () => undefined,
			start: (time: number) => { beat.startedAt = time; this.played.push(beat); },
			stop: (time: number) => { beat.stoppedAt = time; }
		};
	}

	createGain() {
		const beat = this.building!;
		const record = (value: number, time: number) => { beat.envelope.push([value, time]); };
		return {
			gain: {
				setValueAtTime: record,
				exponentialRampToValueAtTime: record,
				linearRampToValueAtTime: record
			},
			connect: () => undefined
		};
	}

	resume() { return Promise.resolve(); }
	close() { return Promise.resolve(); }
}

const defaults = {tempo: 100, timeSignature: "4/4", emphasis: "X"};

// The click uses window timers on purpose, for popout window compatibility. The scheduler is driven by
// hand here, so the timer only needs to exist.
const globals = globalThis as unknown as {window?: unknown};
beforeAll(() => {
	globals.window = {setInterval: () => 1, clearInterval: () => undefined};
});
afterAll(() => {
	delete globals.window;
});

/** Builds a click running at 60 BPM (one beat per second) over a stub context. */
function setup() {
	const meta = parseSongMeta({tempo: 60, "time-signature": "4/4", emphasis: "Xxxx"}, defaults)!;
	const context = new StubAudioContext();
	const transport = new Transport(meta, context as unknown as AudioContext);
	const click = new MetronomeClick(transport, 0.5);
	// Attach the stub without going through prepareAudio, which would build a real AudioContext.
	(click as unknown as {audioContext: StubAudioContext}).audioContext = context;

	const schedule = () => (click as unknown as {schedule: () => void}).schedule();
	return {context, transport, click, schedule};
}

describe("metronome scheduling", () => {
	it("never schedules a beat in the past, or with no lead", () => {
		const {context, transport, click, schedule} = setup();
		transport.start();
		click.start();

		// The scheduler wakes up a little after the beat was due.
		context.currentTime = 0.04;
		schedule();

		expect(context.played.length).toBeGreaterThan(0);
		for (const beat of context.played) {
			expect(beat.startedAt).toBeGreaterThanOrEqual(context.currentTime);
		}
	});

	it("drops a beat missed by more than the tolerance rather than firing it late", () => {
		const {context, transport, click, schedule} = setup();
		transport.start();
		click.start();

		// A long stall: beats 0 through 2 are well gone by the time the scheduler runs.
		context.currentTime = 3;
		schedule();

		// Nothing from the stall, only what is still ahead.
		for (const beat of context.played) {
			expect(beat.startedAt).toBeGreaterThanOrEqual(3);
		}
	});

	describe("after seeking", () => {
		it("does not sound the beat it lands on", () => {
			const {context, transport, click, schedule} = setup();
			transport.start();
			click.start();
			context.currentTime = 0.5;
			schedule();
			const before = context.played.length;

			// Land exactly on beat 8, as clicking a slot does.
            transport.seek(8);
			click.resync();
			schedule();

			// Anything scheduled is properly ahead, not crammed onto the seek instant.
			for (const beat of context.played.slice(before)) {
				expect(beat.startedAt).toBeGreaterThan(context.currentTime);
			}
		});

		it("picks up on the next beat boundary", () => {
			const {context, transport, click, schedule} = setup();
			transport.start();
			click.start();
			context.currentTime = 0.5;
			schedule();
			const before = context.played.length;

			// Land a quarter of the way into beat 8, at one beat per second.
			const seekedAt = context.currentTime;
			transport.seek(8.25);
			click.resync();

			// Three quarters of that beat remain, so beat 9 is due 0.75s later — and not before.
			const dueAt = seekedAt + 0.75;
			context.currentTime = dueAt - 0.05;
			schedule();

			const played = context.played.slice(before);
			expect(played).toHaveLength(1);
			expect(played[0].startedAt).toBeCloseTo(dueAt, 2);
		});
	});

	describe("the envelope", () => {
		it("ramps in rather than starting at full volume", () => {
			const {context, transport, click, schedule} = setup();
			transport.start();
			click.start();
			context.currentTime = 0;
			schedule();

			const [beat] = context.played;
			const [first, second] = beat.envelope;
			// Starts near silence, then rises — a step straight to the peak is what pops.
			expect(first[0]).toBeLessThan(0.01);
			expect(second[0]).toBeGreaterThan(first[0]);
			expect(second[1]).toBeGreaterThan(first[1]);
		});

		it("reaches true silence before the oscillator stops", () => {
			const {context, transport, click, schedule} = setup();
			transport.start();
			click.start();
			context.currentTime = 0;
			schedule();

			const [beat] = context.played;
			const [value, time] = beat.envelope[beat.envelope.length - 1];
			expect(value).toBe(0);
			expect(beat.stoppedAt).toBeGreaterThanOrEqual(time);
		});
	});
});
