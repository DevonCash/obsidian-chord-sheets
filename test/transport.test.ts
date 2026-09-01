/*
 * The transport is the clock everything else reads: the click schedules against it, the scroll and the
 * chord highlight follow it. It counts in the time signature's own note value, because that is what the
 * emphasis pattern and the measure timeline are both counted in — while the tempo may be given in a
 * different note value, so it cannot be used as a rate directly.
 */

import {Transport} from "../src/metronome/transport";
import {barDurationMs, beatDurationMs, parseSongMeta, SongMeta} from "../src/metronome/songMeta";

const defaults = {tempo: 100, timeSignature: "4/4"};

/** An audio clock moved by hand. */
class StubClock {
	currentTime = 0;
	advanceMs(ms: number) {
		this.currentTime += ms / 1000;
	}
}

function running(frontmatter: Record<string, unknown>): {transport: Transport, clock: StubClock, meta: SongMeta} {
	const meta = parseSongMeta({tempo: 120, ...frontmatter}, defaults)!;
	const clock = new StubClock();
	const transport = new Transport(meta, clock as unknown as AudioContext);
	transport.start();
	return {transport, clock, meta};
}

describe("Transport", () => {
	it("advances one beat per beat, as the song's timing says a beat lasts", () => {
		for (const frontmatter of [
			{"time-signature": "4/4"},
			{"time-signature": "12/8"},
			{"time-signature": "12/8", "beat-unit": "3/8"},
			{"time-signature": "2/2", "beat-unit": "1/2"},
			{tempo: 96, "time-signature": "7/8"}
		]) {
			const {transport, clock, meta} = running(frontmatter);
			clock.advanceMs(beatDurationMs(meta) * 5);
			expect(transport.currentBeat()).toBeCloseTo(5);
		}
	});

	it("takes a bar to get through a bar", () => {
		const {transport, clock, meta} = running({"time-signature": "12/8", "beat-unit": "3/8"});
		clock.advanceMs(barDurationMs(meta));
		expect(transport.currentBeat()).toBeCloseTo(meta.beatsPerBar);
	});

	describe("the note value the tempo is counted in", () => {
		// The bug this covers: the transport ran at the tempo number directly, as though the tempo always
		// counted the time signature's own note value. A dotted-quarter tempo then played three times
		// slower than it should, and tapping along with the click read back a third of the tempo.
		it("changes how fast the song runs", () => {
			const dotted = running({tempo: 160, "time-signature": "12/8", "beat-unit": "3/8"});
			const eighths = running({tempo: 160, "time-signature": "12/8", "beat-unit": "1/8"});

			dotted.clock.advanceMs(1000);
			eighths.clock.advanceMs(1000);

			// A dotted quarter is three eighths, so counting them covers three times the ground.
			expect(dotted.transport.currentBeat()).toBeCloseTo(eighths.transport.currentBeat() * 3);
		});

		it("puts 160 dotted quarters a minute four to a bar, one every 375ms", () => {
			const {transport, clock} = running({tempo: 160, "time-signature": "12/8", "beat-unit": "3/8"});
			clock.advanceMs(375);
			// One pulse is three eighths of the twelve in the bar.
			expect(transport.currentBeat()).toBeCloseTo(3);
			clock.advanceMs(375 * 3);
			expect(transport.currentBeat()).toBeCloseTo(12);
		});
	});

	it("reports when each beat falls due, matching where it says it is", () => {
		const {transport, meta} = running({tempo: 160, "time-signature": "12/8", "beat-unit": "3/8"});
		for (const beat of [0, 1, 3, 12, 47.5]) {
			expect(transport.timeOfBeat(beat)).toBeCloseTo(beat * beatDurationMs(meta) / 1000);
		}
	});

	it("holds its place while paused and carries on from there", () => {
		const {transport, clock, meta} = running({"time-signature": "4/4"});
		clock.advanceMs(beatDurationMs(meta) * 3);
		transport.pause();

		clock.advanceMs(10000);
		expect(transport.currentBeat()).toBeCloseTo(3);

		transport.start();
		clock.advanceMs(beatDurationMs(meta));
		expect(transport.currentBeat()).toBeCloseTo(4);
	});

	it("moves to a beat when sought, and keeps running from it", () => {
		const {transport, clock, meta} = running({"time-signature": "4/4"});
		transport.seek(16);
		expect(transport.currentBeat()).toBeCloseTo(16);

		clock.advanceMs(beatDurationMs(meta) * 2);
		expect(transport.currentBeat()).toBeCloseTo(18);
	});

	it("keeps its place when the tempo changes under it", () => {
		const {transport, clock, meta} = running({tempo: 120, "time-signature": "4/4"});
		clock.advanceMs(beatDurationMs(meta) * 4);

		const faster = parseSongMeta({tempo: 240, "time-signature": "4/4"}, defaults)!;
		transport.setSongMeta(faster);
		expect(transport.currentBeat()).toBeCloseTo(4);

		// And runs at the new tempo from there.
		clock.advanceMs(beatDurationMs(faster) * 2);
		expect(transport.currentBeat()).toBeCloseTo(6);
	});
});
