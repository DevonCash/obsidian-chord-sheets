/**
 * Scroll pacing strategies. A pacer is asked, once per animation frame, where the scroll container should
 * be; the playback control assigns that position.
 */

import {MarkdownView} from "obsidian";
import {EditorView} from "@codemirror/view";
import {chordAtBeat, entryIndexAtBeat, SongTimeline} from "./metronome/songTiming";
import {Transport} from "./metronome/transport";
import {renderedBlockLines} from "./renderedChordBlocks";

export const AUTOSCROLL_STEPS = 20;

export interface ScrollPacer {
	/** Desired scrollTop for this frame, or null to leave the scroll position alone. */
	desiredScrollTop(scrollElem: HTMLElement, dtMs: number): number | null;

	/** Called when the document or the layout changed and any cached geometry is stale. */
	invalidate(): void;
}

/**
 * The original speed-slider behaviour: a constant rate, used when the note has no tempo. The rate is the
 * one the old implementation produced (a 1px step at an interval derived from the speed curve), but it is
 * accumulated as a fractional pixel offset per frame instead of a whole pixel per timer tick, which
 * removes the quantisation the speed curve was compensating for.
 */
export class ConstantSpeedPacer implements ScrollPacer {
	private position: number | null = null;

	constructor(private speed: number) {
	}

	setSpeed(speed: number) {
		this.speed = speed;
	}

	invalidate() {
		this.position = null;
	}

	/** Pixels per millisecond for a given 1..AUTOSCROLL_STEPS speed setting. */
	static pixelsPerMs(speed: number): number {
		const highestInterval = 200;
		const lowestInterval = 13;

		// Adjust speed curve for usability. A higher exponent makes speed changes at lower speeds (i.e.,
		// higher intervals) more pronounced.
		const speedCurveExponent = 2.3;
		const normalizedSpeed = (speed - 1) / (AUTOSCROLL_STEPS - 1);
		const adjustedSpeed = Math.pow(normalizedSpeed, speedCurveExponent);

		const intervalRangeFactor = (highestInterval - lowestInterval) / (1 - 1 / AUTOSCROLL_STEPS);
		const intervalRangeConstant = lowestInterval - intervalRangeFactor / AUTOSCROLL_STEPS;

		const interval = intervalRangeFactor / (1 + adjustedSpeed * (AUTOSCROLL_STEPS - 1)) + intervalRangeConstant;
		return 1 / interval;
	}

	desiredScrollTop(scrollElem: HTMLElement, dtMs: number): number {
		if (this.position === null) {
			this.position = scrollElem.scrollTop;
		}
		this.position += ConstantSpeedPacer.pixelsPerMs(this.speed) * dtMs;
		// Do not keep accumulating past the end of the document, or resuming after the content grows
		// would jump forward by however long we sat at the bottom.
		this.position = Math.min(this.position, scrollElem.scrollHeight - scrollElem.clientHeight);
		return this.position;
	}
}

/**
 * How a tempo-aware scroll positions the document.
 *
 * "chord" keeps the chord currently being played at the reading line: the view holds still while a chord
 * sounds and glides on when the next one starts. "continuous" instead interpolates between consecutive
 * chord lines in proportion to the beats elapsed, so the document moves at a steady crawl and each line
 * arrives at the reading line exactly as it starts.
 */
export type TempoScrollMode = "chord" | "continuous";

/** Time constant of the glide between chords, in milliseconds. */
const CHORD_GLIDE_TAU_MS = 180;

/**
 * Tempo-aware pacing. Every chord line is resolved to a vertical position, which the two modes above then
 * use differently.
 */
export class TempoScrollPacer implements ScrollPacer {
	private lineOffsets: number[] | null = null;
	/** Eased scroll position, used by the "chord" mode so it glides rather than jumps between chords. */
	private position: number | null = null;

	constructor(
		private view: MarkdownView,
		private transport: Transport,
		private timeline: SongTimeline,
		private anchorFraction: number,
		private mode: TempoScrollMode = "chord"
	) {
	}

	setTimeline(timeline: SongTimeline) {
		this.timeline = timeline;
		this.invalidate();
	}

	invalidate() {
		this.lineOffsets = null;
	}

	desiredScrollTop(scrollElem: HTMLElement, dtMs: number): number | null {
		const offsets = this.getLineOffsets(scrollElem);
		if (!offsets || offsets.length === 0) {
			return null;
		}

		return this.mode === "chord"
			? this.currentChordScrollTop(scrollElem, offsets, dtMs)
			: this.interpolatedScrollTop(scrollElem, offsets);
	}

	/**
	 * Holds the chord being played at the reading line. The target only moves when the song reaches a
	 * chord on a different line, so the view stays put while a chord sounds; easing towards it turns that
	 * step into a glide instead of a jump.
	 */
	private currentChordScrollTop(scrollElem: HTMLElement, offsets: number[], dtMs: number): number {
		const chord = chordAtBeat(this.timeline, this.transport.currentBeat());
		// Before the first chord, bring its line to the reading line and wait there.
		const target = this.anchor(scrollElem, offsets[chord ? chord.entryIndex : 0]);

		if (this.position === null) {
			// Start from wherever the reader already is, and glide from there.
			this.position = scrollElem.scrollTop;
		}

		// Frame-rate independent exponential easing.
		this.position += (target - this.position) * (1 - Math.exp(-dtMs / CHORD_GLIDE_TAU_MS));
		return this.position;
	}

	/** Moves at a steady crawl, interpolating between chord lines by the beats elapsed. */
	private interpolatedScrollTop(scrollElem: HTMLElement, offsets: number[]): number {
		const {entries} = this.timeline;
		const beat = this.transport.currentBeat();
		const index = entryIndexAtBeat(this.timeline, beat);

		// Before the first chord line: hold still until the song reaches it.
		if (index < 0) {
			return this.anchor(scrollElem, offsets[0]);
		}

		const entry = entries[index];
		const entryBeats = entry.measures * this.timeline.beatsPerBar;
		const progress = entryBeats > 0 ? (beat - entry.startBeat) / entryBeats : 0;

		const from = offsets[index];
		// Past the last chord line, keep going at the rate the final line was scrolling at.
		const to = index + 1 < offsets.length
			? offsets[index + 1]
			: from + (index > 0 ? from - offsets[index - 1] : 0);

		return this.anchor(scrollElem, from + (to - from) * progress);
	}

	/** Converts a position in the scrolled content into a scrollTop that puts it at the reading anchor. */
	private anchor(scrollElem: HTMLElement, contentY: number): number {
		return contentY - scrollElem.clientHeight * this.anchorFraction;
	}

	/**
	 * Vertical position of each chord line within the scrolled content, in timeline order. Cached until
	 * the document or the layout changes.
	 */
	private getLineOffsets(scrollElem: HTMLElement): number[] | null {
		if (this.lineOffsets) {
			return this.lineOffsets;
		}

		const offsets = this.view.getMode() === "preview"
			? this.readingModeOffsets(scrollElem)
			: this.editorOffsets();

		// Only cache once the view has actually been laid out.
		if (offsets && offsets.length > 0) {
			this.lineOffsets = offsets;
		}
		return offsets;
	}

	private editorOffsets(): number[] | null {
		const editorView = this.view.editor?.cm as EditorView | undefined;
		if (!editorView) {
			return null;
		}

		const doc = editorView.state.doc;
		return this.timeline.entries.map(entry => {
			// CodeMirror estimates heights for lines outside the viewport, so this works document-wide.
			const line = doc.line(Math.min(entry.docLine + 1, doc.lines));
			return editorView.lineBlockAt(line.from).top;
		});
	}

	private readingModeOffsets(scrollElem: HTMLElement): number[] | null {
		// The reading mode post processor renders one .chord-sheet-chord-line per line of each block, so
		// a timeline entry is located by its block and its line within that block.
		const scrollRect = scrollElem.getBoundingClientRect();
		const offsets: number[] = [];
		let found = false;

		for (const entry of this.timeline.entries) {
			const lineEl = renderedBlockLines(this.view, entry.blockStartLine)?.[entry.lineInBlock];
			if (!lineEl) {
				// Not rendered (yet) — hold at the previous known position rather than jumping to 0.
				offsets.push(offsets.length > 0 ? offsets[offsets.length - 1] : 0);
				continue;
			}
			found = true;
			offsets.push(lineEl.getBoundingClientRect().top - scrollRect.top + scrollElem.scrollTop);
		}

		// Nothing rendered yet: report no geometry so the caller retries next frame instead of caching
		// a page of zeroes.
		return found ? offsets : null;
	}
}
