import {Component, Events, MarkdownView} from "obsidian";
import {ChordSheetsSettings} from "./chordSheetsSettings";
import {ConstantSpeedPacer, ScrollPacer, TempoScrollPacer} from "./scrollPacer";
import {MetronomeClick} from "./metronome/click";
import {Transport} from "./metronome/transport";
import {parseSongMeta, SongMeta} from "./metronome/songMeta";
import {buildSongTimeline, chordAtBeat, SongTimeline} from "./metronome/songTiming";
import {ChordHighlighter} from "./chordHighlight";
import {TransportControl} from "./transportControl";

export {AUTOSCROLL_STEPS} from "./scrollPacer";

export const SPEED_CHANGED_EVENT = "speed-changed";
export const PLAYBACK_CHANGED_EVENT = "playback-changed";

/**
 * Per-view playback: the scroll and the metronome, both driven off one shared transport so they can never
 * drift apart. Either can run on its own.
 *
 * When the note carries a tempo the scroll is paced by the song's measures; otherwise it falls back to the
 * original constant-speed slider behaviour.
 */
export class PlaybackControl extends Component {
	private control: TransportControl | null = null;
	private frameId: number | null = null;
	private lastFrameTime = 0;

	private scrolling = false;
	/** Scroll offset accumulated from the user scrolling by hand, so nudging the view re-anchors it. */
	private userScrollOffset = 0;
	private lastAppliedScrollTop: number | null = null;

	private readonly transport: Transport;
	private readonly click: MetronomeClick;
	private readonly highlighter: ChordHighlighter;
	private pacer: ScrollPacer;
	/** The song's measure timeline, or null when the note has no tempo to pace against. */
	private timeline: SongTimeline | null = null;

	readonly events = new Events();

	constructor(
		public readonly view: MarkdownView,
		private _speed: number,
		private _songMeta: SongMeta | null,
		private settings: ChordSheetsSettings
	) {
		super();
		this.transport = new Transport(this._songMeta ?? defaultSongMeta(settings));
		this.click = new MetronomeClick(this.transport, settings.metronomeVolume);
		this.highlighter = new ChordHighlighter(view);
		this.pacer = this.createPacer();
		view.addChild(this);
	}

	get isRunning(): boolean {
		return this.scrolling;
	}

	get isMetronomeRunning(): boolean {
		return this.click.isRunning;
	}

	get songMeta(): SongMeta | null {
		return this._songMeta;
	}

	set speed(value: number) {
		const speedValue = Math.min(Math.max(value, 1), 20);
		if (speedValue != this._speed) {
			this._speed = speedValue;

			if (this.pacer instanceof ConstantSpeedPacer) {
				this.pacer.setSpeed(speedValue);
			}

			this.events.trigger(SPEED_CHANGED_EVENT, speedValue);
			this.control?.setSpeed(speedValue);
		}
	}

	get speed(): number {
		return this._speed;
	}

	/** Applies new metronome properties, keeping anything that is currently playing in phase. */
	setSongMeta(songMeta: SongMeta | null) {
		if (songMetaEquals(this._songMeta, songMeta)) {
			return;
		}
		this._songMeta = songMeta;
		this.transport.setSongMeta(songMeta ?? defaultSongMeta(this.settings));
		this.pacer = this.createPacer();
		this.control?.setSongMeta(songMeta);
	}

	updateSettings(settings: ChordSheetsSettings) {
		this.settings = settings;
		this.click.setVolume(settings.metronomeVolume);
		this.pacer = this.createPacer();
		if (!settings.highlightCurrentChord) {
			this.highlighter.clear();
		}
	}

	/** Called when the document changed, so cached line positions (and measures) are recomputed. */
	invalidateGeometry() {
		if (this.isPlaying) {
			// Editing mid-playback can change the measures themselves, not just the layout.
			this.pacer = this.createPacer();
		} else {
			// Nothing is running; starting again builds a fresh pacer anyway.
			this.pacer.invalidate();
		}
	}

	private get isPlaying(): boolean {
		return this.scrolling || this.click.isRunning;
	}

	startScroll() {
		if (this.scrolling) {
			return;
		}
		this.scrolling = true;
		this.userScrollOffset = 0;
		this.lastAppliedScrollTop = null;
		// Build from the current document, so edits made since the last run are accounted for.
		this.pacer = this.createPacer();
		this.transport.start();
		this.showControl();
		this.startFrames();
		this.events.trigger(PLAYBACK_CHANGED_EVENT);
	}

	stopScroll() {
		if (!this.scrolling) {
			return;
		}
		this.scrolling = false;
		this.stopFramesIfIdle();
		this.pauseTransportIfIdle();
		this.updateControlVisibility();
		this.events.trigger(PLAYBACK_CHANGED_EVENT);
	}

	async startMetronome() {
		if (this.click.isRunning) {
			return;
		}
		// Must happen in response to a user gesture, otherwise the audio context stays suspended.
		const audioContext = await this.click.prepareAudio();
		this.transport.setAudioContext(audioContext);
		// Rebuild so the chord highlight follows edits made since the last run.
		this.pacer = this.createPacer();
		this.transport.start();
		this.click.start();
		this.showControl();
		this.startFrames();
		this.events.trigger(PLAYBACK_CHANGED_EVENT);
	}

	stopMetronome() {
		if (!this.click.isRunning) {
			return;
		}
		this.click.stop();
		this.stopFramesIfIdle();
		this.pauseTransportIfIdle();
		this.updateControlVisibility();
		this.events.trigger(PLAYBACK_CHANGED_EVENT);
	}

	/** Stops everything. Kept as `stop` because it is what the plugin calls to shut a view's playback down. */
	stop() {
		const wasPlaying = this.isPlaying;
		this.scrolling = false;
		this.click.stop();
		this.stopFrames();
		this.transport.pause();
		this.transport.reset();
		this.hideControl();
		if (wasPlaying) {
			this.events.trigger(PLAYBACK_CHANGED_EVENT);
		}
	}

	increaseSpeed() {
		this.speed = this.speed + 1;
	}

	decreaseSpeed() {
		this.speed = this.speed - 1;
	}

	onunload() {
		this.stopFrames();
		this.click.destroy();
		this.hideControl();
		super.onunload();
	}

	private pauseTransportIfIdle() {
		if (!this.isPlaying) {
			this.transport.pause();
		}
	}

	private stopFramesIfIdle() {
		if (!this.isPlaying) {
			this.stopFrames();
		}
	}

	private createPacer(): ScrollPacer {
		// The timeline drives the chord highlight as well as the scroll, so it is built whenever the note
		// has a tempo — even if tempo-aware scrolling itself is switched off.
		this.timeline = this._songMeta
			? buildSongTimeline(
				this.view.data,
				this.settings.blockLanguageSpecifier,
				this.settings,
				this._songMeta.beatsPerBar
			)
			: null;

		if (this.timeline && this.timeline.entries.length > 0 && this.settings.tempoAwareAutoscroll) {
			return new TempoScrollPacer(
				this.view, this.transport, this.timeline, this.settings.scrollAnchorFraction
			);
		}
		return new ConstantSpeedPacer(this._speed);
	}

	private getScrollElement(): HTMLElement | null {
		return (this.view.getMode() === "preview"
			? this.view.previewMode.containerEl.firstElementChild
			: this.view.editor?.cm?.scrollDOM) as HTMLElement | null;
	}

	private startFrames() {
		if (this.frameId !== null) {
			return;
		}
		this.lastFrameTime = performance.now();

		const step = () => {
			this.frameId = window.requestAnimationFrame(step);

			const now = performance.now();
			const dtMs = now - this.lastFrameTime;
			this.lastFrameTime = now;

			this.updateChordHighlight();

			const scrollElem = this.scrolling ? this.getScrollElement() : null;
			if (!scrollElem) {
				return;
			}

			// A scroll position we did not set ourselves means the user scrolled by hand; carry that as an
			// offset so the view re-anchors instead of being yanked back on the next frame.
			if (this.lastAppliedScrollTop !== null) {
				this.userScrollOffset += scrollElem.scrollTop - this.lastAppliedScrollTop;
			}

			const desired = this.pacer.desiredScrollTop(scrollElem, dtMs);
			if (desired === null) {
				this.lastAppliedScrollTop = null;
				return;
			}

			const target = Math.max(0, desired + this.userScrollOffset);
			scrollElem.scrollTop = target;
			this.lastAppliedScrollTop = scrollElem.scrollTop;
		};

		this.frameId = window.requestAnimationFrame(step);
	}

	private stopFrames() {
		if (this.frameId !== null) {
			window.cancelAnimationFrame(this.frameId);
			this.frameId = null;
		}
		this.lastAppliedScrollTop = null;
		this.highlighter.clear();
	}

	private updateChordHighlight() {
		if (!this.settings.highlightCurrentChord || !this.timeline) {
			return;
		}
		this.highlighter.show(chordAtBeat(this.timeline, this.transport.currentBeat()));
	}

	private showControl() {
		if (!this.control) {
			this.control = new TransportControl(this.view, this);
			this.control.render();
		}
		this.control.update();
	}

	private updateControlVisibility() {
		if (!this.scrolling && !this.click.isRunning) {
			this.hideControl();
		} else {
			this.control?.update();
		}
	}

	private hideControl() {
		this.control?.remove();
		this.control = null;
	}
}

function songMetaEquals(a: SongMeta | null, b: SongMeta | null): boolean {
	if (a === null || b === null) {
		return a === b;
	}
	return a.bpm === b.bpm
		&& a.beatsPerBar === b.beatsPerBar
		&& a.beatUnit === b.beatUnit
		&& a.pattern.length === b.pattern.length
		&& a.pattern.every((beat, i) => beat === b.pattern[i]);
}

function defaultSongMeta(settings: ChordSheetsSettings): SongMeta {
	return parseSongMeta({tempo: settings.defaultTempo}, {
		tempo: settings.defaultTempo,
		timeSignature: settings.defaultTimeSignature,
		emphasis: settings.defaultEmphasis
	})!;
}
