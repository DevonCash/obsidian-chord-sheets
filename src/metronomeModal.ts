import {App, Modal, Setting, setTooltip, TextComponent} from "obsidian";
import {TapTempo} from "./metronome/tapTempo";

import {
	Beat,
	defaultEmphasis,
	MAX_MEASURES_PER_SYMBOL,
	MAX_TEMPO,
	MIN_TEMPO,
	parseEmphasis,
	parseTimeSignature,
	patternToString,
	SongMeta,
	TEMPO_UNITS,
	parseTempoUnit,
	tempoUnitLabel,
	tempoUnitNotation,
	timeSignatureToString
} from "./metronome/songMeta";

/** Looping the pattern while it is being set, without the song running behind it. */
export interface PatternPreview {
	start: () => Promise<void>;
	stop: () => void;
	/** Which beat of the bar is sounding, or null when the preview is not running. */
	beatInBar: () => number | null;
}
/**
 * Clicking a beat steps it through the three states, building up from silence: a beat is given a click,
 * then an accent, then taken away again.
 */
const NEXT_STATE: Record<Beat, Beat> = {
	silent: "normal",
	normal: "accent",
	accent: "silent"
};

const STATE_LABEL: Record<Beat, string> = {
	accent: "accented",
	normal: "normal",
	silent: "silent"
};

/**
 * The song's metronome settings: tempo, time signature and the emphasis pattern. These are set once for
 * a song rather than adjusted while playing, so they live here rather than on the playback controls.
 *
 * Changes apply as they are made — the metronome keeps running while this is open, so a change can be
 * heard straight away.
 */
export class MetronomeModal extends Modal {
	private meta: SongMeta;
	private beatsEl: HTMLElement | null = null;
	private readoutEl: HTMLElement | null = null;
	private tempoInput: TextComponent | null = null;
	private previewing = false;
	private previewFrame: number | null = null;
	private readonly tapTempo = new TapTempo();

	constructor(
		app: App,
		meta: SongMeta,
		private onChange: (meta: SongMeta) => void,
		private onPreview: (beat: Beat) => void,
		private patternPreview: PatternPreview
	) {
		super(app);
		this.meta = {...meta, pattern: [...meta.pattern]};
	}

	onOpen() {
		const {contentEl, titleEl} = this;
		titleEl.setText("Metronome");

		new Setting(contentEl)
			.setName("Time signature")
			.setDesc("Any signature, for example 4/4, 6/8, 7/8, 12/8 or 8/4.")
			.addText(text => text
				.setValue(timeSignatureToString(this.meta))
				.onChange(value => {
					const signature = parseTimeSignature(value);
					text.inputEl.toggleClass("chord-sheet-invalid", !signature);
					if (signature) {
						this.apply({...signature, pattern: this.patternFor(signature)});
						this.renderBeats();
					}
				})
			);

		// Labelled like the settings above it rather than as a heading, so the three read as one list.
		new Setting(contentEl)
			.setName("Tempo")
			.setDesc("Beats per minute. Tap the button in time to set it by ear.")

			.addText(text => {
				this.tempoInput = text;
				text.inputEl.type = "number";
				text.inputEl.min = String(MIN_TEMPO);
				text.inputEl.max = String(MAX_TEMPO);
				text.setValue(String(this.meta.bpm)).onChange(value => {
					const bpm = parseFloat(value);
					const valid = !isNaN(bpm) && bpm >= MIN_TEMPO && bpm <= MAX_TEMPO;
					text.inputEl.toggleClass("chord-sheet-invalid", !valid);
					if (valid) {
						// Typing a tempo abandons any tapping in progress.
						this.tapTempo.reset();
						this.apply({bpm});
					}
				});
			})
			.addButton(button => {
				button.buttonEl.addClass("chord-sheet-tap-tempo");
				button
					.setButtonText("Tap")
					.setTooltip("Tap in time with the music to set the tempo")
					.onClick(() => this.tap(button.buttonEl));
			});

		new Setting(contentEl)
			.setName("Beat unit")
			.setDesc("The note value a beat is. A compound meter is counted in dotted notes by default, "
				+ "so 12/8 is four dotted quarters rather than twelve eighths.")
			.addDropdown(dropdown => {
				TEMPO_UNITS.forEach(unit => dropdown.addOption(unit.notation, tempoUnitLabel(unit)));
				dropdown
					.setValue(tempoUnitNotation(this.meta))
					.onChange(notation => {
						const tempoUnit = parseTempoUnit(notation);
						if (tempoUnit !== null) {
							this.apply({tempoUnit});
						}
					});
			});

		new Setting(contentEl)
			.setName("Measures per symbol")
			.setDesc("How many measures each notated measure stands for. A sheet writing one symbol "
				+ "where the song plays it for four bars sets this to 4.")
			.addText(text => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = String(MAX_MEASURES_PER_SYMBOL);
				text.setValue(String(this.meta.measuresPerSymbol)).onChange(value => {
					const measuresPerSymbol = parseInt(value, 10);
					const valid = !isNaN(measuresPerSymbol)
						&& measuresPerSymbol >= 1
						&& measuresPerSymbol <= MAX_MEASURES_PER_SYMBOL;
					text.inputEl.toggleClass("chord-sheet-invalid", !valid);
					if (valid) {
						this.apply({measuresPerSymbol});
					}
				});
			});

		new Setting(contentEl)
			.setName("Emphasis")
			.setDesc("Click a beat to step it through silent, normal and accented, and hear it.")
			.addButton(button => {
				button.buttonEl.addClass("chord-sheet-pattern-preview");
				button
					.setButtonText("Preview")
					.setTooltip("Loop the pattern without moving the page behind")
					.onClick(() => void this.togglePreview(button.buttonEl));
			});

		// The same shape the playback controls show, drawn over the beat it belongs to.
		this.readoutEl = contentEl.createDiv({cls: "chord-sheet-emphasis-readout"});
		this.beatsEl = contentEl.createDiv({cls: "chord-sheet-emphasis-beats"});

		this.renderBeats();
	}

	onClose() {
		// The loop belongs to the dialog, so it goes when the dialog does.
		this.patternPreview.stop();
		this.stopFollowingBeat();
		this.previewing = false;
		this.contentEl.empty();
	}

	private async togglePreview(buttonEl: HTMLElement) {
		if (this.previewing) {
			this.patternPreview.stop();
			this.stopFollowingBeat();
		} else {
			await this.patternPreview.start();
			this.followBeat();
		}
		this.previewing = !this.previewing;
		buttonEl.setText(this.previewing ? "Stop" : "Preview");
		buttonEl.toggleClass("is-active", this.previewing);
	}

	/** Lights the beat the preview is on, so the pattern can be followed as well as heard. */
	private followBeat() {
		const step = () => {
			this.previewFrame = window.requestAnimationFrame(step);
			const playing = this.patternPreview.beatInBar();
			// Re-applied every frame rather than only on change, so it survives the readout being
			// rebuilt when the pattern is edited mid-preview.
			Array.from(this.readoutEl?.children ?? [])
				.forEach((beatEl, index) => beatEl.toggleClass("is-playing", index === playing));
		};
		this.previewFrame = window.requestAnimationFrame(step);
	}

	private stopFollowingBeat() {
		if (this.previewFrame !== null) {
			window.cancelAnimationFrame(this.previewFrame);
			this.previewFrame = null;
		}
		Array.from(this.readoutEl?.children ?? [])
			.forEach(beatEl => beatEl.removeClass("is-playing"));
	}

	/** One tap of the tempo: the first has no interval to measure, so it only invites another. */
	private tap(buttonEl: HTMLElement) {
		const bpm = this.tapTempo.tap(performance.now());
		// The count is shown because it is the one thing a wrong reading cannot tell you: a tempo that
		// comes out a clean fraction of what was tapped means taps went missing, not that the average
		// was off.
		buttonEl.setText(`Tap (${this.tapTempo.count})`);
		if (bpm === null) {
			return;
		}

		this.tempoInput?.setValue(String(bpm));
		this.tempoInput?.inputEl.removeClass("chord-sheet-invalid");
		this.apply({bpm});
	}

	/**
	 * The pattern to carry into a new meter. A pattern left as the old meter was counted follows to how
	 * the new one is counted, so changing 4/4 to 12/8 gives four pulses rather than twelve clicks. One
	 * that has been edited is kept and refitted instead, since it was set deliberately.
	 */
	private patternFor(signature: {beatsPerBar: number, beatUnit: number}): Beat[] {
		const current = patternToString(this.meta);
		const wasDefault = current === patternToString({
			pattern: defaultEmphasis(this.meta.beatsPerBar, this.meta.beatUnit)
		});

		return wasDefault
			? defaultEmphasis(signature.beatsPerBar, signature.beatUnit)
			: parseEmphasis(current, signature.beatsPerBar)!;
	}

	private apply(changes: Partial<SongMeta>) {
		this.meta = {...this.meta, ...changes};
		this.onChange(this.meta);
	}

	private renderBeats() {
		const {beatsEl, readoutEl} = this;
		if (!beatsEl || !readoutEl) {
			return;
		}

		beatsEl.empty();
		readoutEl.empty();

		this.meta.pattern.forEach((state, index) => {
			// A full-height column holding the bar, so the whole beat can be lit while it sounds.
			readoutEl
				.createDiv({cls: "chord-sheet-emphasis-readout-beat"})
				.createDiv({cls: ["chord-sheet-emphasis-readout-bar", `is-${state}`]});

			const button = beatsEl.createEl("button", {
				cls: ["chord-sheet-emphasis-beat", `is-${state}`],
				text: String(index + 1)
			});
			setTooltip(button, `Beat ${index + 1} is ${STATE_LABEL[state]}`);
			button.addEventListener("click", () => {
				const pattern = [...this.meta.pattern];
				pattern[index] = NEXT_STATE[pattern[index]];
				this.apply({pattern});
				this.renderBeats();
				// Hear the beat that was just set, rather than having to run the metronome to find out.
				this.onPreview(pattern[index]);
			});
		});
	}
}
