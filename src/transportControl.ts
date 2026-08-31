import {debounce, MarkdownView, setIcon, setTooltip, SliderComponent} from "obsidian";
import {MetronomeModal} from "./metronomeModal";
import type {PlaybackControl} from "./playbackControl";
import {AUTOSCROLL_STEPS} from "./scrollPacer";
import {
	EMPHASIS_PROPERTY,
	patternToString,
	SongMeta,
	TEMPO_PROPERTY,
	TIME_SIGNATURE_PROPERTY,
	timeSignatureToString
} from "./metronome/songMeta";

/**
 * The playback bar shown at the top of the note while the scroll or the metronome is running.
 *
 * Notes with a tempo get metronome controls: BPM, a free-text time signature (any n/d, so odd meters like
 * 12/8 or 8/4 can simply be typed) and a per-beat emphasis pattern. Notes without one keep the original
 * speed slider.
 */
export class TransportControl {
	private containerEl: HTMLElement | null = null;
	private slider: SliderComponent | null = null;
	private settingsButton: HTMLElement | null = null;
	private scrollButton: HTMLElement | null = null;
	private metronomeButton: HTMLElement | null = null;
	/** Whether the currently rendered bar has metronome controls rather than the speed slider. */
	private renderedWithMetronome = false;

	constructor(private view: MarkdownView, private playback: PlaybackControl) {
	}

	render() {
		this.remove();

		// Appended rather than prepended, so the bar sits along the bottom of the view.
		const containerEl = this.view.contentEl.createDiv({
			cls: "chord-sheet-autoscroll-control"
		});
		this.containerEl = containerEl;
		this.liftClearOfStatusBar(containerEl);

		this.scrollButton = containerEl.createEl("button", {cls: "chord-sheet-transport-play"});
		// One transport control: it starts and stops the scroll and the click together.
		this.scrollButton.addEventListener("click", () => void (async () => {
			await this.playback.togglePlay();
			this.update();
		})());

		const songMeta = this.playback.songMeta;
		this.renderedWithMetronome = !!songMeta;
		if (songMeta) {
			this.renderMetronomeControls(containerEl, songMeta);
		} else {
			containerEl.createSpan({cls: "chord-sheet-transport-label", text: "Autoscroll speed"});
			this.slider = new SliderComponent(containerEl)
				.setLimits(1, AUTOSCROLL_STEPS, 1)
				.setDynamicTooltip()
				.setValue(this.playback.speed)
				.onChange(value => this.playback.speed = value);
		}

		this.update();
	}

	private renderMetronomeControls(containerEl: HTMLElement, songMeta: SongMeta) {
		// Only silences the click; it never starts or stops the song.
		this.metronomeButton = containerEl.createEl("button", {cls: "chord-sheet-transport-mute"});
		this.metronomeButton.addEventListener("click", () => {
			this.playback.toggleMute();
			this.update();
		});

		// Tempo, meter and emphasis are set once for a song rather than adjusted while playing, so the
		// bar shows them and opens the dialog rather than carrying editable fields of its own.
		this.settingsButton = containerEl.createEl("button", {cls: "chord-sheet-transport-settings"});
		this.settingsButton.addEventListener("click", () => this.openMetronomeModal());
		this.renderSummary(songMeta);
	}

	/** The song's settings at a glance: tempo, meter, and the shape of the emphasis pattern. */
	private renderSummary(songMeta: SongMeta) {
		const button = this.settingsButton;
		if (!button) {
			return;
		}

		button.empty();
		const textEl = button.createDiv({cls: "chord-sheet-transport-summary"});
		textEl.createSpan({cls: "chord-sheet-transport-tempo", text: String(songMeta.bpm)});
		textEl.createSpan({
			cls: "chord-sheet-transport-time-signature",
			text: timeSignatureToString(songMeta)
		});

		const patternEl = button.createDiv({cls: "chord-sheet-transport-emphasis"});
		songMeta.pattern.forEach(beat => patternEl.createSpan({
			cls: ["chord-sheet-transport-emphasis-beat", `is-${beat}`]
		}));

		setTooltip(button, `${songMeta.bpm} BPM, ${timeSignatureToString(songMeta)}, `
			+ `emphasis ${patternToString(songMeta)} — click to edit`);
	}

	private openMetronomeModal() {
		const songMeta = this.playback.songMeta;
		if (!songMeta) {
			return;
		}

		// Written back as the settings are edited, but not on every keystroke: the metronome follows each
		// change straight away, while the note is only rewritten once the editing stops.
		const save = debounce((meta: SongMeta) => this.saveProperties({
			[TEMPO_PROPERTY]: meta.bpm,
			[TIME_SIGNATURE_PROPERTY]: timeSignatureToString(meta),
			[EMPHASIS_PROPERTY]: patternToString(meta)
		}), 400, true);

		new MetronomeModal(
			this.view.app,
			songMeta,
			meta => {
				// Keep the running metronome and the bar in step ahead of the frontmatter write.
				this.playback.setSongMeta(meta);
				this.renderSummary(meta);
				save(meta);
			},
			beat => void this.playback.previewBeat(beat)
		).open();
	}

	private saveProperties(properties: Record<string, unknown>) {
		const file = this.view.file;
		if (!file) {
			return;
		}
		this.view.app.fileManager.processFrontMatter(file, frontmatter => {
			Object.assign(frontmatter, properties);
		}).then();
	}

	/**
	 * Obsidian's status bar floats over the bottom right of the window, above anything a view puts there,
	 * so the transport bar is lifted to sit on top of it rather than underneath. It lives outside the
	 * view, which is why this cannot be expressed in the stylesheet alone.
	 *
	 * Only the view the status bar actually reaches is lifted, so a pane in the upper half of a split
	 * keeps its bar flush to its own bottom edge.
	 */
	private liftClearOfStatusBar(containerEl: HTMLElement) {
		const statusBar = containerEl.ownerDocument.body.querySelector(".status-bar");
		const statusRect = statusBar?.getBoundingClientRect();
		const viewRect = this.view.contentEl.getBoundingClientRect();

		const overlaps = !!statusRect
			&& statusRect.height > 0
			&& viewRect.bottom > statusRect.top
			&& viewRect.right > statusRect.left;

		containerEl.style.setProperty(
			"--chord-sheet-transport-bottom", overlaps ? `${statusRect.height}px` : "0px"
		);
	}

	setSpeed(speed: number) {
		if (this.slider && this.slider.getValue() !== speed) {
			this.slider.setValue(speed);
		}
	}

	setSongMeta(songMeta: SongMeta | null) {
		// The set of controls depends on whether the note has a tempo at all, so rebuild from scratch.
		if (!!songMeta !== this.renderedWithMetronome || !this.containerEl) {
			this.render();
			return;
		}
		if (songMeta) {
			this.renderSummary(songMeta);
		}
	}

	update() {
		if (this.scrollButton) {
			const playing = this.playback.isPlaying;
			setIcon(this.scrollButton, playing ? "pause-circle" : "play-circle");
			setTooltip(this.scrollButton, playing ? "Pause" : "Play");
			this.scrollButton.toggleClass("is-active", playing);
		}

		if (this.metronomeButton) {
			const muted = this.playback.isMuted;
			setIcon(this.metronomeButton, muted ? "volume-x" : "volume-2");
			setTooltip(this.metronomeButton, muted ? "Unmute metronome" : "Mute metronome");
			this.metronomeButton.toggleClass("is-active", !muted);
		}
	}

	remove() {
		this.containerEl?.remove();
		this.containerEl = null;
		this.slider = null;
		this.settingsButton = null;
		this.scrollButton = null;
		this.metronomeButton = null;
	}
}
