import {MarkdownView, setIcon, setTooltip, SliderComponent} from "obsidian";
import type {PlaybackControl} from "./playbackControl";
import {AUTOSCROLL_STEPS} from "./scrollPacer";
import {
	EMPHASIS_PROPERTY,
	MAX_TEMPO,
	MIN_TEMPO,
	parseEmphasis,
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
	private emphasisInput: HTMLInputElement | null = null;
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

		this.tempoInput = this.createField(containerEl, "Tempo (BPM)", "chord-sheet-transport-tempo",
			String(songMeta.bpm), value => {
				const bpm = parseFloat(value);
				return isNaN(bpm) || bpm < MIN_TEMPO || bpm > MAX_TEMPO ? null : {[TEMPO_PROPERTY]: bpm};
			});
		this.tempoInput.type = "number";
		this.tempoInput.min = String(MIN_TEMPO);
		this.tempoInput.max = String(MAX_TEMPO);

		this.timeSignatureInput = this.createField(containerEl, "Time signature",
			"chord-sheet-transport-time-signature", timeSignatureToString(songMeta), value =>
				parseTimeSignature(value) ? {[TIME_SIGNATURE_PROPERTY]: value.trim()} : null
		);

		this.emphasisInput = this.createField(containerEl, "Emphasis: X accent, x normal, _ silent",
			"chord-sheet-transport-emphasis", patternToString(songMeta), value => {
				const beatsPerBar = parseTimeSignature(this.timeSignatureInput?.value)?.beatsPerBar
					?? songMeta.beatsPerBar;
				return parseEmphasis(value, beatsPerBar) ? {[EMPHASIS_PROPERTY]: value.trim()} : null;
			});
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
			this.updateFieldValue(this.emphasisInput, patternToString(songMeta));
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
		this.emphasisInput = null;
		this.scrollButton = null;
		this.metronomeButton = null;
	}
}

function activeElement(): Element | null {
	return document.activeElement;
}
