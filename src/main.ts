// noinspection JSUnusedGlobalSymbols

import {addIcon, debounce, Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TFile, View} from 'obsidian';
import {EditorView, ViewPlugin} from "@codemirror/view";
import {ChordBlockPostProcessorView} from "./chordBlockPostProcessorView";
import {ChordSheetsSettings, DEFAULT_SETTINGS, ShowAutoscrollButtonSetting} from "./chordSheetsSettings";
import {Extension} from "@codemirror/state";
import {
	chordSheetEditorPlugin,
	ChordSheetsViewPlugin,
	ChordSymbolRange,
	EnharmonicToggleEventDetail,
	TransposeEventDetail
} from "./editor-extension/chordSheetsViewPlugin";
import {InstrumentChangeEventDetail} from "./editor-extension/chordBlockToolsWidget";
import {PLAYBACK_CHANGED_EVENT, PlaybackControl, SPEED_CHANGED_EVENT} from "./playbackControl";
import {
	EMPHASIS_PROPERTY,
	MAX_TEMPO,
	MIN_TEMPO,
	parseSongMeta,
	SongMeta,
	TEMPO_PROPERTY,
	TIME_SIGNATURE_PROPERTY
} from "./metronome/songMeta";
import {ChordSheetsSettingTab} from "./chordSheetsSettingTab";
import {IChordSheetsPlugin} from "./chordSheetsPluginInterface";
import {chordSheetsEditorExtension} from "./editor-extension/chordSheetsEditorExtension";
import {addCustomChordTypes} from "./customChordTypes";
import {enharmonicToggle, transpose} from "./chordProcessing";
import {Instrument} from "./instruments/types";
import {instruments} from "./instruments/instruments";
import {TapTempo} from "./metronome/tapTempo";
import {SLOT_SELECTOR} from "./renderedChordBlocks";


const AUTOSCROLL_SPEED_PROPERTY = "autoscroll-speed";

export default class ChordSheetsPlugin extends Plugin implements IChordSheetsPlugin {
	declare settings: ChordSheetsSettings;
	editorPlugin: ViewPlugin<ChordSheetsViewPlugin>;
	editorExtension: Extension[] | null;

	viewPlaybackControlMap = new WeakMap<View, PlaybackControl>();
	private readonly tapTempo = new TapTempo();

	async onload() {
		addCustomChordTypes();
		await this.loadSettings();
		this.app.workspace.trigger("parse-style-settings");
		addIcon("enharmonic-toggle", enharmonicToggleIcon);

		// Register code block post processor for reading mode

		this.registerMarkdownPostProcessor((element, context) => {
			const codeblocks = element.querySelectorAll("code[class*=language-chords]");
			for (let index = 0; index < codeblocks.length; index++) {
				const codeblock = codeblocks.item(index);
				const langClass = Array.from(codeblock.classList).find(cls => cls.startsWith("language-chords"))?.substring(9);
				if (langClass) {
					const instrumentString = langClass.split("-")[1];
					const instrument = instrumentString as Instrument ?? this.settings.defaultInstrument;

					// Record which block this is, so playback can find it by document position. Reading
					// mode unloads sections that are far off-screen, so counting rendered blocks in
					// document order would pick the wrong one on a long note.
					const lineStart = context.getSectionInfo(codeblock.parentElement!)?.lineStart;
					if (lineStart !== undefined) {
						codeblock.parentElement!.dataset.chordSheetBlockLine = String(lineStart);
					}
					context.addChild(new ChordBlockPostProcessorView(
						codeblock.parentElement!,
						instrument,
						this.settings
					));
				}
			}

		});



		// Register editor extension for edit / live preview mode

		this.editorPlugin = chordSheetEditorPlugin();
		this.editorExtension = chordSheetsEditorExtension(this.settings, this.editorPlugin);
		this.registerEditorExtension(this.editorExtension);


		// Handle chord sheet custom events sent by the editor extension

		this.registerDomEvent(window, "chord-sheet-instrument-change", (event: CustomEvent<InstrumentChangeEventDetail>) => {
			const editor = this.app.workspace.activeEditor?.editor;
			const { selectedInstrument, from } = event.detail;
			if (editor) {
				const editorView = editor.cm as EditorView;
				this.changeInstrument(editorView, selectedInstrument as Instrument, from);
			}
		});

		this.registerDomEvent(window, "chord-sheet-transpose", async (event: CustomEvent<TransposeEventDetail>) => {
			const {direction, blockDef} = event.detail;
			const editor = this.app.workspace.activeEditor?.editor;

			if (editor) {
				// @ts-ignore
				const editorView = editor.cm as EditorView;
				const chordPlugin = editorView?.plugin(this.editorPlugin);
				if (chordPlugin) {
					const chordTokens = await chordPlugin.getChordSymbolRangesForBlock(blockDef);
					this.transpose(chordTokens, editorView, direction);
				}
			}
		});

        this.registerDomEvent(window, "chord-sheet-enharmonic-toggle", async (event: CustomEvent<EnharmonicToggleEventDetail>) => {
			const {blockDef} = event.detail;
			const editor = this.app.workspace.activeEditor?.editor;

			if (editor) {
				// @ts-ignore
				const editorView = editor.cm as EditorView;
				const chordPlugin = editorView?.plugin(this.editorPlugin);
				if (chordPlugin) {
					const chordTokens = await chordPlugin.getChordSymbolRangesForBlock(blockDef);
					this.enharmonicToggle(chordTokens, editorView);
				}
			}
		});


		this.registerDomEvent(document, "click", (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest(SLOT_SELECTOR)) {
				this.seekToClickedSlot(target);
			}
		});


		// Handle obsidian events

		// Rebuilding the action buttons is cheap and must follow edits, but stopping playback must not:
		// killing the metronome and scroll on every keystroke would make them unusable while editing.
		const debouncePlaybackUpdate = debounce((view: View | MarkdownFileInfo | null) => {
			if (view instanceof MarkdownView) {
				this.viewPlaybackControlMap.get(view)?.invalidateGeometry();
				this.updatePlaybackButtons(view);
			}
		}, 100, false);


		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.stopAllPlayback();
				if (leaf?.view) {
					debouncePlaybackUpdate(leaf.view);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", (_editor, view) => {
				debouncePlaybackUpdate(view);
			})
		);

		// Editing the note's properties should take effect immediately, without a restart.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view?.file === file) {
					this.viewPlaybackControlMap.get(view)?.setSongMeta(this.getSongMetaFromFrontmatter(file));
				}
			})
		);


		// Register editor commands

		this.addCommand({
			id: 'block-instrument-change-default',
			name: `Change instrument for the current chord block to the default instrument (${(this.settings.defaultInstrument)})`,
			editorCheckCallback: (checking: boolean, _editor: Editor, view: MarkdownView)  => {
				return this.changeInstrumentCommand(view, this.editorPlugin, checking, null);
			}
		});

		for (const instrument of instruments) {
			this.addCommand({
				id: `block-instrument-change-${instrument}`,
				name: `Change instrument for the current chord block to ${instrument}`,
				editorCheckCallback: (checking: boolean, _editor: Editor, view: MarkdownView)  => {
					return this.changeInstrumentCommand(view, this.editorPlugin, checking, instrument);
				}
			});
		}

		this.addCommand({
			id: 'transpose-block-up',
			name: 'Transpose current chord block one semitone up',
			editorCheckCallback: (checking: boolean, editor: Editor) =>
				this.transposeCommand(editor, this.editorPlugin, checking, "up")
		});

		this.addCommand({
			id: 'transpose-block-down',
			name: 'Transpose current chord block one semitone down',
			editorCheckCallback: (checking: boolean, editor: Editor) =>
				this.transposeCommand(editor, this.editorPlugin, checking, "down")
		});

        this.addCommand({
			id: 'enharmonic-toggle',
			name: 'Enharmonically toggle chords in current block between sharp (#) and flat (b).',
			editorCheckCallback: (checking: boolean, editor: Editor) =>
				this.enharmonicToggleCommand(editor, this.editorPlugin, checking)
		});

		this.addCommand({
			id: 'toggle-autoscroll',
			name: 'Play or pause',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) {
					return false;
				}

				if (!checking) {
					void this.togglePlay(view);
				}

				return true;
			}
		});

		this.addCommand({
			id: 'autoscroll-increase',
			name: 'Increase autoscroll speed',
			editorCheckCallback: (checking: boolean) => this.adjustScrollSpeedCommand('increase', checking)
		});

		this.addCommand({
			id: 'autoscroll-decrease',
			name: 'Decrease autoscroll speed',
			editorCheckCallback: (checking: boolean) => this.adjustScrollSpeedCommand('decrease', checking)
		});

		this.addCommand({
			id: 'autoscroll-save',
			name: 'Save current autoscroll speed to frontmatter',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return;
				}

				const playbackControl = this.viewPlaybackControlMap.get(view);
				const speed = playbackControl?.speed ?? this.settings.autoscrollDefaultSpeed;


				if (!checking) {
					this.saveAutoscrollSpeed(view.file, speed);
				}

				return true;
			}
		});

		this.addCommand({
			id: 'toggle-metronome',
			name: 'Mute or unmute the metronome',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return false;
				}

				if (!checking) {
					this.toggleMute(view);
				}

				return true;
			}
		});

		this.addCommand({
			id: 'tempo-increase',
			name: 'Increase tempo by 5 BPM',
			checkCallback: (checking) => this.adjustTempoCommand(5, checking)
		});

		this.addCommand({
			id: 'tempo-decrease',
			name: 'Decrease tempo by 5 BPM',
			checkCallback: (checking) => this.adjustTempoCommand(-5, checking)
		});

		this.addCommand({
			id: 'tap-tempo',
			name: 'Tap tempo',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return false;
				}

				if (!checking) {
					this.tapTempoCommand(view.file);
				}

				return true;
			}
		});


		this.addSettingTab(new ChordSheetsSettingTab(this.app, this));

		this.registerMetadataType(AUTOSCROLL_SPEED_PROPERTY, "number");
		this.registerMetadataType(TEMPO_PROPERTY, "number");
		this.registerMetadataType(TIME_SIGNATURE_PROPERTY, "text");
		this.registerMetadataType(EMPHASIS_PROPERTY, "text");
	}

	private registerMetadataType(property: string, type: "number" | "text") {
		if (this.getMetadataType(property) !== type) {
			this.app.metadataTypeManager.setType(property, type);
		}
	}

	private getMetadataType(property: string) {
		// old API <= 1.9.1
		if (this.app.metadataTypeManager.getAssignedType) {
			return this.app.metadataTypeManager.getAssignedType(property);
		}
		// @ts-ignore new API >= 1.9.2
		const typeInfo = this.app.metadataTypeManager.getTypeInfo(property);
		return typeInfo.expected.type;
	}

	private changeInstrumentCommand(view: MarkdownView, plugin: ViewPlugin<ChordSheetsViewPlugin>, checking: boolean, instrument: Instrument | null) {
		const editorView = view.editor.cm as EditorView;
		const chordPlugin = editorView.plugin(plugin);
		if (chordPlugin) {
			const chordSheetBlockAtCursor = chordPlugin.getChordSheetBlockAtCursor();
			if (!chordSheetBlockAtCursor) {
				return false;
			}

			if (!checking) {
				this.changeInstrument(editorView, instrument, chordSheetBlockAtCursor.from);
			}
		}

		return true;
	}

	private transposeCommand(editor: Editor, plugin: ViewPlugin<ChordSheetsViewPlugin>, checking: boolean, direction: "up" | "down") {
		const editorView = editor.cm as EditorView;
		const chordPlugin = editorView.plugin(plugin);
		if (chordPlugin) {
			const chordSheetBlockAtCursor = chordPlugin.getChordSheetBlockAtCursor();
			if (!chordSheetBlockAtCursor) {
				return false;
			}

			if (!checking) {
				chordPlugin.getChordSymbolRangesForBlock(chordSheetBlockAtCursor).then(
					chordTokens => this.transpose(chordTokens, editorView, direction)
				);
			}
		}

		return true;
	}

    private enharmonicToggleCommand(editor: Editor, plugin: ViewPlugin<ChordSheetsViewPlugin>, checking: boolean) {
		const editorView = editor.cm as EditorView;
		const chordPlugin = editorView.plugin(plugin);
		if (chordPlugin) {
			const chordSheetBlockAtCursor = chordPlugin.getChordSheetBlockAtCursor();
			if (!chordSheetBlockAtCursor) {
				return false;
			}

			if (!checking) {
				chordPlugin.getChordSymbolRangesForBlock(chordSheetBlockAtCursor).then(
					chordTokens => this.enharmonicToggle(chordTokens, editorView)
				);
			}
		}

		return true;
	}

	private adjustScrollSpeedCommand(action: 'increase' | 'decrease', checking: boolean) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return false;
		}

		const playbackControl = this.viewPlaybackControlMap.get(view);
		if (!playbackControl || !playbackControl.isPlaying) {
			return false;
		}

		if (!checking) {
			if (playbackControl) {
				action === 'increase' ? playbackControl.increaseSpeed() : playbackControl.decreaseSpeed();
			}
		}

		return true;
	}

	private changeInstrument(editor: EditorView, selectedInstrument: Instrument | null, blockStart: number) {
		const languageSpecifier = this.settings.blockLanguageSpecifier;
		const newInstrumentDef = selectedInstrument === null
			? languageSpecifier
			: `${languageSpecifier}-${selectedInstrument}`;
		const editorView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (editorView) {
			const lineNo = editorView.editor.offsetToPos(blockStart).line;
			const startLine = editorView.editor.getLine(lineNo);
			const newLine = startLine.replace(/\w+\S+/, newInstrumentDef);
			// editorView.editor.setLine(lineNo, newLine)
			editor.plugin(this.editorPlugin)?.applyChanges([{
				from: blockStart,
				to: blockStart + startLine.length,
				insert: newLine
			}]);
		}
	}

	private transpose(chordRanges: ChordSymbolRange[], editor: EditorView, direction: "up" | "down") {
		const changes = transpose(chordRanges, direction);
		editor.plugin(this.editorPlugin)?.applyChanges(changes);
	}

    private enharmonicToggle(chordTokenRanges: ChordSymbolRange[], editor: EditorView) {
		const changes = enharmonicToggle(chordTokenRanges);
		if (changes.length === 0) {
			new Notice("No chords with accidentals were found.");
			return;
		}
		editor.plugin(this.editorPlugin)?.applyChanges(changes);
	}

	/** The view action shows and hides the controls; pausing is done on the controls themselves. */
	private togglePlaybackControls(view: MarkdownView) {
		this.getPlaybackControl(view)?.toggleControls();
	}

	private async togglePlay(view: MarkdownView) {
		await this.getPlaybackControl(view)?.togglePlay();
	}

	/**
	 * Clicking a chord or a rhythm marker moves playback to it, so a phrase can be picked up from where
	 * it starts — a bar of nothing but repeat markers is as clickable as a chord. Only while the controls
	 * are up, so it does not interfere with ordinary editing.
	 */
	private seekToClickedSlot(target: HTMLElement) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const playbackControl = view && this.viewPlaybackControlMap.get(view);
		if (!view || !playbackControl?.isControlVisible) {
			return;
		}

		const slot = view.getMode() === "preview"
			? this.renderedSlotAt(playbackControl, target)
			: this.editorSlotAt(view, playbackControl, target);

		if (slot) {
			playbackControl.seekToSlot(slot);
		}
	}

	private editorSlotAt(view: MarkdownView, playbackControl: PlaybackControl, target: HTMLElement) {
		const editorView = view.editor?.cm as EditorView | undefined;
		if (!editorView) {
			return null;
		}
		return playbackControl.slotAtOffset(editorView.posAtDOM(target));
	}

	private renderedSlotAt(playbackControl: PlaybackControl, target: HTMLElement) {
		const slotEl = target.closest(SLOT_SELECTOR);
		const lineEl = slotEl?.parentElement;
		const blockEl = slotEl?.closest("[data-chord-sheet-block-line]") as HTMLElement | null;
		if (!slotEl || !lineEl || !blockEl?.dataset.chordSheetBlockLine) {
			return null;
		}

		const linesEl = lineEl.parentElement;
		return playbackControl.slotAtRenderedPosition(
			parseInt(blockEl.dataset.chordSheetBlockLine, 10),
			linesEl ? Array.from(linesEl.children).indexOf(lineEl) : -1,
			// Chords and rhythm markers render as one element each, in the order they were tokenized.
			Array.from(lineEl.querySelectorAll(SLOT_SELECTOR)).indexOf(slotEl)
		);
	}

	private toggleMute(view: MarkdownView) {
		const playbackControl = this.getPlaybackControl(view);
		if (!playbackControl) {
			return;
		}
		playbackControl.toggleMute();
		// Remembered across notes and sessions: whether you want to hear a click is a standing preference,
		// not something to re-set every time.
		this.settings.metronomeMuted = playbackControl.isMuted;
		void this.saveSettings();
	}

	private updatePlaybackButtons(view: MarkdownView | MarkdownFileInfo) {
		if (!(view instanceof MarkdownView)) {
			return;
		}
		const editorView = view.editor?.cm as EditorView | undefined;
		const plugin = editorView?.plugin(this.editorPlugin);
		if (!plugin) {
			return;
		}

		const playbackControl = this.viewPlaybackControlMap.get(view);
		const hasChordBlocks = plugin.hasChordBlocks();

		const controlsVisible = playbackControl?.isControlVisible ?? false;
		this.updateActionButton(
			view, ".chord-sheet-autoscroll-action", this.settings.showAutoscrollButton, hasChordBlocks,
			controlsVisible ? "music" : "play-circle",
			controlsVisible ? "Hide playback controls" : "Show playback controls",
			() => this.togglePlaybackControls(view)
		);

	}

	private updateActionButton(
		view: MarkdownView,
		cls: string,
		visibility: ShowAutoscrollButtonSetting,
		hasChordBlocks: boolean,
		icon: string,
		tooltip: string,
		onClick: () => void
	) {
		const existingEl: HTMLElement | null = view.containerEl.querySelector(cls);
		const shouldShowButton = visibility === "always" || (hasChordBlocks && visibility === "chord-blocks");

		if (!shouldShowButton) {
			existingEl?.remove();
			return;
		}

		if (!existingEl || icon !== existingEl.dataset.icon) {
			existingEl?.remove();
			const viewEl = view.addAction(icon, tooltip, onClick);
			viewEl.addClass(cls.substring(1));
			viewEl.dataset.icon = icon;
		}
	}

	private getAutoscrollSpeedFromFrontmatter(file: TFile | null): number | null {
		if (!file) {
			return null;
		}
		const frontmatterSpeedValue = this.app.metadataCache.getFileCache(file)?.frontmatter?.[AUTOSCROLL_SPEED_PROPERTY];
		const frontmatterSpeedNumber = parseInt(frontmatterSpeedValue);
		return frontmatterSpeedNumber && !isNaN(frontmatterSpeedNumber)
			? frontmatterSpeedNumber
			: null;
	}

	/** Reads the note's metronome properties, or null when it has no tempo set. */
	private getSongMetaFromFrontmatter(file: TFile | null): SongMeta | null {
		if (!file) {
			return null;
		}
		return parseSongMeta(this.app.metadataCache.getFileCache(file)?.frontmatter, {
			tempo: this.settings.defaultTempo,
			timeSignature: this.settings.defaultTimeSignature,
			emphasis: this.settings.defaultEmphasis
		});
	}

	/** Returns the view's playback control, creating it on first use. */
	private getPlaybackControl(view: MarkdownView): PlaybackControl | null {
		const activeFile = view.file;
		if (!activeFile) {
			return null;
		}

		const frontmatterSpeed = this.getAutoscrollSpeedFromFrontmatter(activeFile);
		const songMeta = this.getSongMetaFromFrontmatter(activeFile);

		let playbackControl = this.viewPlaybackControlMap.get(view);
		if (playbackControl) {
			if (frontmatterSpeed && frontmatterSpeed != playbackControl.speed) {
				playbackControl.speed = frontmatterSpeed;
			}
			playbackControl.setSongMeta(songMeta);
			return playbackControl;
		}

		const speed = frontmatterSpeed ?? this.settings.autoscrollDefaultSpeed;

		playbackControl = new PlaybackControl(view, speed, songMeta, this.settings);
		this.registerEvent(playbackControl.events.on(SPEED_CHANGED_EVENT, (newSpeed: number) => {
			// Update the speed saved in frontmatter if needed

			const file = view.file;
			if (!file) {
				return;
			}

			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const isSpeedInFrontmatter = frontmatter && AUTOSCROLL_SPEED_PROPERTY in frontmatter;

			if (this.settings.alwaysSaveAutoscrollSpeedToFrontmatter || isSpeedInFrontmatter) {
				this.saveAutoscrollSpeed(file, newSpeed);
			}
		}));
		this.registerEvent(playbackControl.events.on(PLAYBACK_CHANGED_EVENT, () =>
			this.updatePlaybackButtons(view)
		));

		this.viewPlaybackControlMap.set(view, playbackControl);
		return playbackControl;
	}

	private saveAutoscrollSpeed(file: TFile, newSpeed: number) {
		this.app.fileManager.processFrontMatter(file, frontmatter => {
			frontmatter[AUTOSCROLL_SPEED_PROPERTY] = this.getMetadataType(AUTOSCROLL_SPEED_PROPERTY) === "number"
				? newSpeed
				: newSpeed.toString();
		}).then();
	}

	stopAllPlayback() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view.getViewType() === "markdown") {
				this.viewPlaybackControlMap.get(leaf.view)?.stop();
			}
		});
	}

	/** Sets the note's tempo from the interval between successive invocations of the command. */
	private tapTempoCommand(file: TFile) {
		const bpm = this.tapTempo.tap(performance.now());
		if (bpm === null) {
			new Notice("Tap tempo: keep tapping…");
			return;
		}
		this.saveTempo(file, bpm);
		new Notice(`Tempo: ${bpm} BPM`);
	}

	private adjustTempoCommand(delta: number, checking: boolean): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const songMeta = view?.file ? this.getSongMetaFromFrontmatter(view.file) : null;
		if (!view?.file || !songMeta) {
			return false;
		}

		if (!checking) {
			this.saveTempo(view.file, songMeta.bpm + delta);
		}

		return true;
	}

	private saveTempo(file: TFile, bpm: number) {
		const clamped = Math.min(Math.max(Math.round(bpm), MIN_TEMPO), MAX_TEMPO);
		this.app.fileManager.processFrontMatter(file, frontmatter => {
			frontmatter[TEMPO_PROPERTY] = this.getMetadataType(TEMPO_PROPERTY) === "number"
				? clamped
				: clamped.toString();
		}).then();
	}

	applyNewSettingsToEditors() {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view.getViewType() === "markdown") {
				const markdownView = leaf.view as MarkdownView;
				const editorView = markdownView.editor?.cm as EditorView | null;
				markdownView.previewMode?.rerender(true);
				this.viewPlaybackControlMap.get(markdownView)?.updateSettings(this.settings);
				const chordPlugin = editorView?.plugin(this.editorPlugin);
				chordPlugin?.updateSettings(this.settings);
			}
		});

		if (this.editorExtension) {
			this.editorExtension.length = 0;
			this.editorExtension.push(...chordSheetsEditorExtension(this.settings, this.editorPlugin));
			this.app.workspace.updateOptions();
		}
	}


	onunload() {
		this.stopAllPlayback();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

const enharmonicToggleIcon = `<g>
    <path d="m 67.938374,81.624479 c 2.039181,-1.006678 3.932707,-2.348915 5.971893,-3.556933 3.058768,-2.147583 6.263191,-4.160945 8.884993,-6.84542 C 84.615959,69.4101 86.21817,66.926959 86.145346,63.8398 86.072466,60.551317 83.96051,58.068173 81.70285,56.725929 78.279936,54.645461 74.128749,54.444121 70.123215,56.323277" style="stroke-width:7.75711"/>
    <line x1="67.719902" y1="32.028694" x2="67.647064" y2="81.356026" style="stroke-width:7.75711"/>
    <g transform="matrix(4.3305517,0,0,4.3305517,-0.68684179,0.35334386)">
      <line x1="5.8633256" y1="5.3617735" x2="5.8478827" y2="16.646721"/>
      <line x1="9.8784332" y1="4.2660093" x2="9.8629894" y2="15.550956"/>
    </g>
    <g transform="matrix(4.3305517,0,0,4.3305517,-1.389032,-0.21026658)">
      <g transform="translate(0,0.49467325)">
        <path d="M 12.426756,6.5789032 3.6238563,8.7457333"/>
        <line x1="12.426755" y1="11.437944" x2="3.6238565" y2="13.604775"/>
      </g>
    </g>
  </g>`;
