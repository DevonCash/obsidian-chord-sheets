import {debounce, MarkdownView, setIcon, setTooltip, SliderComponent} from "obsidian";
import {EmphasisModal} from "./emphasisModal";
import type {PlaybackControl} from "./playbackControl";
import {AUTOSCROLL_STEPS} from "./scrollPacer";
import {
	Beat,
	EMPHASIS_PROPERTY,
	MAX_TEMPO,
	MIN_TEMPO,
	parseTimeSignature,
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
	private tempoInput: HTMLInputElement | null = null;
	private timeSignatureInput: HTMLInputElement | null = null;
	private emphasisButton: HTMLElement | null = null;
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

		this.scrollButton = containerEl.createEl("button", {
			cls: ["chord-sheet-transport-button", "chord-sheet-transport-play"]
		});
		this.scrollButton.addEventListener("click", () => {
			this.playback.isRunning ? this.playback.stopScroll() : this.playback.startScroll();
			this.update();
		});

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
		this.metronomeButton = containerEl.createEl("button", {cls: "chord-sheet-transport-button"});
		this.metronomeButton.addEventListener("click", () => void (async () => {
			this.playback.isMetronomeRunning
				? this.playback.stopMetronome()
				: await this.playback.startMetronome();
			this.update();
		})());

		// The bar is two rows tall, so tempo and time signature stack into it side by side.
		const fieldsEl = containerEl.createDiv({cls: "chord-sheet-transport-fields"});

		this.tempoInput = this.createField(fieldsEl, "Tempo (BPM)", "chord-sheet-transport-tempo",
			String(songMeta.bpm), value => {
				const bpm = parseFloat(value);
				return isNaN(bpm) || bpm < MIN_TEMPO || bpm > MAX_TEMPO ? null : {[TEMPO_PROPERTY]: bpm};
			});
		this.tempoInput.type = "number";
		this.tempoInput.min = String(MIN_TEMPO);
		this.tempoInput.max = String(MAX_TEMPO);

		this.timeSignatureInput = this.createField(fieldsEl, "Time signature",
			"chord-sheet-transport-time-signature", timeSignatureToString(songMeta), value =>
				parseTimeSignature(value) ? {[TIME_SIGNATURE_PROPERTY]: value.trim()} : null
		);

		this.emphasisButton = containerEl.createEl("button", {cls: "chord-sheet-transport-emphasis"});
		this.emphasisButton.addEventListener("click", () => this.openEmphasisModal());
		this.renderEmphasis(songMeta);
	}

	/**
	 * Shows the pattern as one element per beat, so the bar carries the same shape the dialog edits.
	 */
	private renderEmphasis(songMeta: SongMeta) {
		const button = this.emphasisButton;
		if (!button) {
			return;
		}

		button.empty();
		songMeta.pattern.forEach(beat => button.createSpan({
			cls: ["chord-sheet-transport-emphasis-beat", `is-${beat}`]
		}));
		setTooltip(button, `Emphasis: ${patternToString(songMeta)} — click to edit`);
	}

	private openEmphasisModal() {
		const songMeta = this.playback.songMeta;
		if (!songMeta) {
			return;
		}

		// Written back as the pattern is edited, but not on every click: the metronome hears each change
		// straight away, while the note is only rewritten once the clicking stops.
		const save = debounce(
			(pattern: Beat[]) => this.saveProperties({
				[EMPHASIS_PROPERTY]: patternToString({pattern})
			}),
			400, true
		);

		new EmphasisModal(
			this.view.app, songMeta.beatsPerBar, songMeta.beatUnit, songMeta.pattern,
			pattern => {
				// Read the song back rather than reusing the copy captured when the dialog opened, so an
				// edit made to the note meanwhile is not undone by a click in here.
				const current = this.playback.songMeta ?? songMeta;
				// Keep the running metronome and the bar in step ahead of the frontmatter write.
				this.playback.setSongMeta({...current, pattern});
				this.renderEmphasis({...current, pattern});
				save(pattern);
			}
		).open();
	}

	/**
	 * A text field that writes its value back to the note's frontmatter once it parses. Invalid input is
	 * flagged inline and never saved.
	 */
	private createField(
		containerEl: HTMLElement,
		tooltip: string,
		cls: string,
		value: string,
		parse: (value: string) => Record<string, unknown> | null
	): HTMLInputElement {
		const el = containerEl.createEl("input", {cls: ["chord-sheet-transport-field", cls], value});
		setTooltip(el, tooltip);

		const commit = () => {
			const properties = parse(el.value);
			el.toggleClass("chord-sheet-transport-field-invalid", properties === null);
			if (properties) {
				this.saveProperties(properties);
			}
		};

		el.addEventListener("change", commit);
		el.addEventListener("blur", commit);
		return el;
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
			this.updateFieldValue(this.tempoInput, String(songMeta.bpm));
			this.updateFieldValue(this.timeSignatureInput, timeSignatureToString(songMeta));
			this.renderEmphasis(songMeta);
		}
	}

	private updateFieldValue(el: HTMLInputElement | null, value: string) {
		// Do not fight the user while they are typing in the field.
		if (el && el !== activeElement() && el.value !== value) {
			el.value = value;
		}
	}

	update() {
		if (this.scrollButton) {
			const running = this.playback.isRunning;
			setIcon(this.scrollButton, running ? "pause-circle" : "play-circle");
			setTooltip(this.scrollButton, running ? "Pause autoscroll" : "Start autoscroll");
			this.scrollButton.toggleClass("is-active", running);
		}

		if (this.metronomeButton) {
			const running = this.playback.isMetronomeRunning;
			setIcon(this.metronomeButton, running ? "volume-2" : "volume-x");
			setTooltip(this.metronomeButton, running ? "Stop metronome" : "Start metronome");
			this.metronomeButton.toggleClass("is-active", running);
		}
	}

	remove() {
		this.containerEl?.remove();
		this.containerEl = null;
		this.slider = null;
		this.tempoInput = null;
		this.timeSignatureInput = null;
		this.emphasisButton = null;
		this.scrollButton = null;
		this.metronomeButton = null;
	}
}

function activeElement(): Element | null {
	return document.activeElement;
}
