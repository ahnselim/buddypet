import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

type PetMood = "idle" | "happy" | "sleepy" | "hungry" | "excited";
type PetTheme = "rainbow" | "yellow" | "pink" | "skyblue" | "mint" | "yellowgreen";
type PetColorMode = "bright" | "dark";

interface PetState {
  name: string;
  theme: PetTheme;
  colorMode: PetColorMode;
  level: number;
  xp: number;
  hunger: number;
  energy: number;
  happiness: number;
  saveActivity: Record<string, number>;
  lastUpdatedAt: number;
}

interface ContributionDay {
  dateKey: string;
  count: number;
  level: number;
  isToday: boolean;
}

interface PetSnapshot extends PetState {
  mood: PetMood;
  imageUri: string;
  contributions: ContributionDay[];
  todaySaves: number;
}

interface WebviewMessage {
  command?: string;
  name?: string;
  theme?: string;
  mode?: string;
}

const STATE_KEY = "codeBuddyPet.state";
const NAME_CONFIRMED_KEY = "codeBuddyPet.nameConfirmed";
const DEFAULT_STATE: PetState = {
  name: "",
  theme: "rainbow",
  colorMode: "bright",
  level: 1,
  xp: 0,
  hunger: 35,
  energy: 78,
  happiness: 72,
  saveActivity: {},
  lastUpdatedAt: Date.now()
};

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];
const LEGACY_DEFAULT_NAMES = new Set(["Mochi", "GGAMJIK"]);
const THEME_OPTIONS = [
  {
    id: "rainbow",
    label: "Rainbow",
    background: "linear-gradient(135deg, #ff9a9e 0%, #ffd36e 20%, #abf7b1 40%, #8edcff 60%, #9ba8ff 80%, #ffb5e8 100%)",
    panel: "rgba(42, 31, 53, 0.18)",
    preview: "linear-gradient(135deg, #ff8d9d 0%, #ffcf63 20%, #8ded9c 40%, #7ddaff 60%, #929dff 80%, #ff9cd9 100%)"
  },
  {
    id: "yellow",
    label: "Yellow",
    background: "linear-gradient(135deg, #fff3b2 0%, #ffe07a 45%, #ffbf5f 100%)",
    panel: "rgba(68, 47, 20, 0.16)",
    preview: "linear-gradient(135deg, #fff1a1 0%, #ffdc65 50%, #ffb84d 100%)"
  },
  {
    id: "pink",
    label: "Pink",
    background: "linear-gradient(135deg, #ffd7ea 0%, #ff9ccc 50%, #ff6ea8 100%)",
    panel: "rgba(73, 28, 54, 0.17)",
    preview: "linear-gradient(135deg, #ffd0e6 0%, #ff92c5 50%, #ff5f9e 100%)"
  },
  {
    id: "skyblue",
    label: "Skyblue",
    background: "linear-gradient(135deg, #dff6ff 0%, #9bdcff 52%, #5daeff 100%)",
    panel: "rgba(25, 52, 80, 0.16)",
    preview: "linear-gradient(135deg, #d8f2ff 0%, #8fd7ff 50%, #4da6ff 100%)"
  },
  {
    id: "mint",
    label: "Mint",
    background: "linear-gradient(135deg, #ddfff2 0%, #99f1d4 52%, #55d4b3 100%)",
    panel: "rgba(24, 67, 53, 0.16)",
    preview: "linear-gradient(135deg, #d5ffef 0%, #88ebca 50%, #46cda7 100%)"
  },
  {
    id: "yellowgreen",
    label: "Yellowgreen",
    background: "linear-gradient(135deg, #f4ffbf 0%, #d8ec75 48%, #97cf52 100%)",
    panel: "rgba(43, 67, 24, 0.16)",
    preview: "linear-gradient(135deg, #f0ffae 0%, #cee466 50%, #88c84b 100%)"
  }
] as const;

function isPetTheme(value: string | undefined): value is PetTheme {
  return THEME_OPTIONS.some((option) => option.id === value);
}

function isPetColorMode(value: string | undefined): value is PetColorMode {
  return value === "bright" || value === "dark";
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

class PetPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private view?: vscode.WebviewView;
  private state: PetState;
  private tickHandle?: NodeJS.Timeout;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = this.loadState();
  }

  public get assetDirectory(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, "media", "states");
  }

  public refresh(): void {
    this.applyIdleDrift();
    if (this.syncConfiguredName()) {
      this.saveState();
    }
    this.render();
  }

  public feed(): void {
    if (!this.ensurePetName()) {
      return;
    }
    this.applyIdleDrift();
    this.state.hunger = clamp(this.state.hunger - 22);
    this.state.happiness = clamp(this.state.happiness + 5);
    this.persistAndRender("Snack time.");
  }

  public play(): void {
    if (!this.ensurePetName()) {
      return;
    }
    this.applyIdleDrift();
    this.state.happiness = clamp(this.state.happiness + 14);
    this.state.energy = clamp(this.state.energy - 12);
    this.state.hunger = clamp(this.state.hunger + 8);
    this.state.xp += 6;
    this.handleLevelUps();
    this.persistAndRender("That was fun.");
  }

  public nap(): void {
    if (!this.ensurePetName()) {
      return;
    }
    this.applyIdleDrift();
    this.state.energy = clamp(this.state.energy + 25);
    this.state.hunger = clamp(this.state.hunger + 6);
    this.persistAndRender("Tiny nap complete.");
  }

  public pet(): void {
    if (!this.ensurePetName()) {
      return;
    }
    this.applyIdleDrift();
    this.state.happiness = clamp(this.state.happiness + 8);
    this.persistAndRender("Your pet looks delighted.");
  }

  public reset(): void {
    const currentName = this.state.name.trim() || this.getConfiguredName();
    this.state = this.createDefaultState(currentName, this.state.theme, this.state.colorMode);
    this.persistAndRender("Pet progress reset.");
  }

  public recordSaveActivity(): void {
    if (this.isNameSetupPending()) {
      return;
    }
    this.applyIdleDrift();
    this.state.xp += 4;
    this.state.hunger = clamp(this.state.hunger + 2);
    this.state.happiness = clamp(this.state.happiness + 1);
    this.recordContribution();
    this.handleLevelUps();
    this.persistAndRender();
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    };

    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      switch (message.command) {
        case "feed":
          this.feed();
          break;
        case "play":
          this.play();
          break;
        case "nap":
          this.nap();
          break;
        case "pet":
          this.pet();
          break;
        case "openAssets":
          void this.openAssetFolder();
          break;
        case "reset":
          this.reset();
          break;
        case "saveName":
          void this.savePetName(message.name);
          break;
        case "setTheme":
          this.setTheme(message.theme);
          break;
        case "setMode":
          this.setColorMode(message.mode);
          break;
        case "rename":
          void this.renamePet();
          break;
        default:
          break;
      }
    }, undefined, this.disposables);

    this.startTicking();
    this.render();
  }

  public async openAssetFolder(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.assetDirectory);
    await vscode.commands.executeCommand("revealFileInOS", this.assetDirectory);
  }

  public dispose(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
    }
    this.onDidChangeEmitter.dispose();
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private createDefaultState(name?: string, theme?: string, colorMode?: string): PetState {
    const configuredName = name?.trim() ?? this.getConfiguredName();
    return {
      ...DEFAULT_STATE,
      name: configuredName || DEFAULT_STATE.name,
      theme: this.normalizeTheme(theme),
      colorMode: this.normalizeColorMode(colorMode),
      lastUpdatedAt: Date.now()
    };
  }

  private getConfiguredName(): string {
    return vscode.workspace.getConfiguration("codeBuddyPet").get<string>("petName", "").trim();
  }

  private loadState(): PetState {
    const savedState = this.context.globalState.get<PetState>(STATE_KEY);
    const defaultState = this.createDefaultState();
    if (!savedState) {
      return defaultState;
    }

    return {
      ...defaultState,
      ...savedState
    };
  }

  private normalizeTheme(theme?: string): PetTheme {
    return isPetTheme(theme) ? theme : DEFAULT_STATE.theme;
  }

  private normalizeColorMode(mode?: string): PetColorMode {
    return isPetColorMode(mode) ? mode : DEFAULT_STATE.colorMode;
  }

  private hasPetName(): boolean {
    return this.state.name.trim().length > 0;
  }

  private isNameSetupPending(): boolean {
    if (!this.hasPetName()) {
      return true;
    }

    if (this.context.globalState.get<boolean>(NAME_CONFIRMED_KEY, false)) {
      return false;
    }

    return this.getConfiguredName().length === 0 && LEGACY_DEFAULT_NAMES.has(this.state.name.trim());
  }

  private ensurePetName(): boolean {
    if (!this.isNameSetupPending()) {
      return true;
    }

    void vscode.window.showInformationMessage("Open Code Buddy Pet and choose a name first.");
    return false;
  }

  private syncConfiguredName(): boolean {
    const configuredName = this.getConfiguredName();
    if (!configuredName || configuredName === this.state.name) {
      return false;
    }

    this.state.name = configuredName;
    return true;
  }

  private setTheme(theme?: string): void {
    const nextTheme = this.normalizeTheme(theme);
    if (nextTheme === this.state.theme) {
      return;
    }

    this.state.theme = nextTheme;
    this.saveState();
    this.render();
  }

  private setColorMode(mode?: string): void {
    const nextMode = this.normalizeColorMode(mode);
    if (nextMode === this.state.colorMode) {
      return;
    }

    this.state.colorMode = nextMode;
    this.saveState();
    this.render();
  }

  private async renamePet(): Promise<void> {
    const nextName = await vscode.window.showInputBox({
      title: "Rename your pet",
      prompt: "Enter a new name for your pet.",
      value: this.hasPetName() ? this.state.name : "",
      ignoreFocusOut: true,
      validateInput: (value) => {
        return value.trim().length > 0 ? undefined : "Please enter a name for your pet.";
      }
    });
    if (typeof nextName !== "string") {
      return;
    }

    await this.savePetName(nextName);
  }

  private startTicking(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
    }

    const tickMinutes = vscode.workspace.getConfiguration("codeBuddyPet").get<number>("tickMinutes", 15);
    const intervalMs = Math.max(1, tickMinutes) * 60 * 1000;
    this.tickHandle = setInterval(() => {
      this.applyIdleDrift();
      this.persistAndRender();
    }, intervalMs);
  }

  private applyIdleDrift(): void {
    const now = Date.now();
    const elapsedMs = now - this.state.lastUpdatedAt;
    const tickMinutes = Math.max(
      1,
      vscode.workspace.getConfiguration("codeBuddyPet").get<number>("tickMinutes", 15)
    );
    const tickMs = tickMinutes * 60 * 1000;

    if (elapsedMs < tickMs) {
      return;
    }

    const steps = Math.floor(elapsedMs / tickMs);
    this.state.hunger = clamp(this.state.hunger + steps * 5);
    this.state.energy = clamp(this.state.energy - steps * 4);
    this.state.happiness = clamp(this.state.happiness - steps * 3);
    this.state.lastUpdatedAt = this.state.lastUpdatedAt + steps * tickMs;
  }

  private handleLevelUps(): void {
    while (this.state.xp >= this.requiredXpForNextLevel()) {
      this.state.xp -= this.requiredXpForNextLevel();
      this.state.level += 1;
      this.state.happiness = clamp(this.state.happiness + 10);
      this.state.energy = clamp(this.state.energy + 5);
    }
  }

  private requiredXpForNextLevel(): number {
    return 20 + (this.state.level - 1) * 10;
  }

  private buildSnapshot(webview: vscode.Webview): PetSnapshot {
    const mood = this.determineMood();
    const imageUri = this.resolveImageUri(webview, mood);
    const contributions = this.buildContributionDays();
    const todayKey = this.getDateKey(new Date());
    return {
      ...this.state,
      mood,
      imageUri,
      contributions,
      todaySaves: this.state.saveActivity[todayKey] ?? 0
    };
  }

  private recordContribution(): void {
    const todayKey = this.getDateKey(new Date());
    const currentCount = this.state.saveActivity[todayKey] ?? 0;
    this.state.saveActivity = {
      ...this.state.saveActivity,
      [todayKey]: currentCount + 1
    };
  }

  private getDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private getContributionLevel(count: number): number {
    if (count >= 8) {
      return 4;
    }
    if (count >= 5) {
      return 3;
    }
    if (count >= 3) {
      return 2;
    }
    if (count >= 1) {
      return 1;
    }
    return 0;
  }

  private buildContributionDays(totalDays = 84): ContributionDay[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - (totalDays - 1));

    return Array.from({ length: totalDays }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const dateKey = this.getDateKey(date);
      const count = this.state.saveActivity[dateKey] ?? 0;

      return {
        dateKey,
        count,
        level: this.getContributionLevel(count),
        isToday: dateKey === this.getDateKey(today)
      };
    });
  }

  private determineMood(): PetMood {
    if (this.state.energy <= 30) {
      return "sleepy";
    }
    if (this.state.hunger >= 70) {
      return "hungry";
    }
    if (this.state.happiness >= 85) {
      return "excited";
    }
    if (this.state.happiness >= 65) {
      return "happy";
    }
    return "idle";
  }

  private resolveImageUri(webview: vscode.Webview, mood: PetMood): string {
    const candidates = [mood, "idle"];
    for (const candidate of candidates) {
      const fileUri = this.findStateImage(candidate);
      if (fileUri) {
        return webview.asWebviewUri(fileUri).toString();
      }
    }

    return "";
  }

  private findStateImage(name: string): vscode.Uri | undefined {
    for (const extension of IMAGE_EXTENSIONS) {
      const fileUri = vscode.Uri.joinPath(this.assetDirectory, `${name}${extension}`);
      if (fs.existsSync(fileUri.fsPath)) {
        return fileUri;
      }
    }

    return undefined;
  }

  private persistAndRender(statusMessage?: string): void {
    this.state.lastUpdatedAt = Date.now();
    this.saveState();
    if (statusMessage) {
      void vscode.window.setStatusBarMessage(statusMessage, 2500);
    }
    this.render();
  }

  private saveState(): void {
    void this.context.globalState.update(STATE_KEY, this.state);
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    if (this.isNameSetupPending()) {
      this.view.webview.html = this.getSetupHtml();
      return;
    }

    const snapshot = this.buildSnapshot(this.view.webview);
    this.view.webview.html = this.getPetHtml(snapshot);
  }

  private getThemeOption(theme: PetTheme) {
    return THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0];
  }

  private getThemeToggleMarkup(activeTheme: PetTheme): string {
    const activeThemeOption = this.getThemeOption(activeTheme);
    const menuMarkup = THEME_OPTIONS.map((option) => {
      const activeClass = option.id === activeTheme ? "active" : "";
      return `
        <button
          class="theme-option ${activeClass}"
          type="button"
          data-theme-option="${option.id}"
        >
          <span class="theme-swatch" style="background-image: ${option.preview};"></span>
          <span>${option.label}</span>
        </button>
      `;
    }).join("");

    return `
      <div class="theme-dropdown" data-theme-dropdown>
        <div class="theme-split-button">
          <button class="theme-current" type="button" data-theme-trigger>
            Theme ${escapeHtml(activeThemeOption.label)}
          </button>
          <button class="theme-caret" type="button" data-theme-trigger aria-label="Open theme menu">
            ▾
          </button>
        </div>
        <div class="theme-menu" data-theme-menu>
          ${menuMarkup}
        </div>
      </div>
    `;
  }

  private getThemeDropdownScript(): string {
    return `
      for (const button of document.querySelectorAll("[data-mode-option]")) {
        button.addEventListener("click", () => {
          vscode.postMessage({
            command: "setMode",
            mode: button.getAttribute("data-mode-option")
          });
        });
      }

      for (const dropdown of document.querySelectorAll("[data-theme-dropdown]")) {
        const triggers = dropdown.querySelectorAll("[data-theme-trigger]");
        const menu = dropdown.querySelector("[data-theme-menu]");
        const options = dropdown.querySelectorAll("[data-theme-option]");

        const closeMenu = () => {
          dropdown.removeAttribute("data-open");
        };

        for (const trigger of triggers) {
          trigger.addEventListener("click", (event) => {
            event.stopPropagation();
            if (dropdown.hasAttribute("data-open")) {
              closeMenu();
            } else {
              dropdown.setAttribute("data-open", "true");
            }
          });
        }

        for (const option of options) {
          option.addEventListener("click", () => {
            vscode.postMessage({
              command: "setTheme",
              theme: option.dataset.themeOption
            });
            closeMenu();
          });
        }
      }

      document.addEventListener("click", () => {
        for (const dropdown of document.querySelectorAll("[data-theme-dropdown][data-open]")) {
          dropdown.removeAttribute("data-open");
        }
      });
    `;
  }

  private getModeToggleMarkup(activeMode: PetColorMode): string {
    const brightClass = activeMode === "bright" ? "active" : "";
    const darkClass = activeMode === "dark" ? "active" : "";

    return `
      <div class="mode-toggle" aria-label="Text color mode">
        <button class="mode-option ${brightClass}" type="button" data-mode-option="bright">Bright</button>
        <button class="mode-option ${darkClass}" type="button" data-mode-option="dark">Dark</button>
      </div>
    `;
  }

  private getColorModeTokens(mode: PetColorMode) {
    if (mode === "dark") {
      return {
        text: "rgba(255, 255, 255, 0.96)",
        muted: "rgba(255, 255, 255, 0.76)"
      };
    }

    return {
      text: "#181818",
      muted: "rgba(24, 24, 24, 0.72)"
    };
  }

  private getComicMonoFontUri(): string {
    if (!this.view) {
      return "";
    }

    return this.view.webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "fonts", "ComicMono.ttf"))
      .toString();
  }

  private getSetupHtml(): string {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const theme = this.getThemeOption(this.state.theme);
    const colorMode = this.getColorModeTokens(this.state.colorMode);
    const modeToggleMarkup = this.getModeToggleMarkup(this.state.colorMode);
    const themeToggleMarkup = this.getThemeToggleMarkup(this.state.theme);
    const themeDropdownScript = this.getThemeDropdownScript();
    const cspSource = this.view?.webview.cspSource ?? "";
    const comicMonoFontUri = this.getComicMonoFontUri();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Code Buddy Pet Setup</title>
    <style>
      @font-face {
        font-family: "Comic Mono";
        src: url("${comicMonoFontUri}") format("truetype");
        font-display: swap;
      }

      :root {
        color-scheme: light dark;
        --bg-gradient: ${theme.background};
        --panel: ${theme.panel};
        --panel-border: rgba(255, 255, 255, 0.24);
        --text: ${colorMode.text};
        --muted: ${colorMode.muted};
        --field-bg: rgba(255, 255, 255, 0.22);
        --field-border: rgba(255, 255, 255, 0.3);
        --button-bg: rgba(255, 255, 255, 0.24);
        --shadow: rgba(0, 0, 0, 0.18);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        font-family: "Comic Mono", var(--vscode-font-family), monospace;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.35), transparent 42%),
          var(--bg-gradient);
      }

      .shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 16px;
      }

      .card {
        width: min(100%, 360px);
        display: grid;
        gap: 14px;
        padding: 20px;
        border-radius: 20px;
        background: var(--panel);
        border: 1px solid var(--panel-border);
        box-shadow: 0 16px 40px var(--shadow);
        backdrop-filter: blur(12px);
      }

      .card-topbar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      h1 {
        margin: 0;
        font-size: 24px;
      }

      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
      }

      form {
        display: grid;
        gap: 10px;
      }

      label {
        font-size: 12px;
        font-weight: 600;
      }

      input {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--field-border);
        background: var(--field-bg);
        color: inherit;
        font: inherit;
        padding: 12px 14px;
      }

      input::placeholder {
        color: var(--muted);
      }

      button {
        border: 1px solid var(--field-border);
        background: var(--button-bg);
        color: inherit;
        border-radius: 12px;
        padding: 11px 14px;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }

      button:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .mode-toggle {
        display: inline-flex;
        gap: 4px;
        padding: 3px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.16);
      }

      .mode-option {
        border: 0;
        background: transparent;
        border-radius: 999px;
        min-height: 32px;
        padding: 7px 12px;
      }

      .mode-option.active {
        background: rgba(255, 255, 255, 0.34);
      }

      .theme-dropdown {
        position: relative;
      }

      .theme-split-button {
        display: inline-flex;
      }

      .theme-current,
      .theme-caret {
        min-height: 38px;
        border-color: rgba(255, 255, 255, 0.38);
        background: rgba(255, 255, 255, 0.22);
      }

      .theme-current {
        border-radius: 12px 0 0 12px;
        border-right-width: 0;
        padding: 9px 12px;
      }

      .theme-caret {
        border-radius: 0 12px 12px 0;
        width: 40px;
        padding: 0;
      }

      .theme-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 10;
        min-width: 176px;
        display: none;
        padding: 8px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: rgba(28, 28, 28, 0.22);
        backdrop-filter: blur(14px);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
      }

      .theme-dropdown[data-open] .theme-menu {
        display: grid;
        gap: 6px;
      }

      .theme-option {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 40px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid transparent;
        background: rgba(255, 255, 255, 0.08);
        text-align: left;
      }

      .theme-option:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      .theme-option.active {
        border-color: rgba(255, 255, 255, 0.45);
        background: rgba(255, 255, 255, 0.2);
      }

      .theme-swatch {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        flex-shrink: 0;
        border: 1px solid rgba(255, 255, 255, 0.32);
        background-size: cover;
        background-position: center;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <div class="card-topbar">
          ${modeToggleMarkup}
          ${themeToggleMarkup}
        </div>

        <div class="eyebrow">First Hello</div>
        <h1>Name your buddy</h1>
        <p>Choose a name once, and your pet will start following your coding progress right away.</p>

        <form id="setup-form">
          <label for="pet-name">Pet name</label>
          <input id="pet-name" name="petName" type="text" maxlength="24" placeholder="Mochi" autofocus />
          <button type="submit">Start together</button>
        </form>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const form = document.getElementById("setup-form");
      const input = document.getElementById("pet-name");

      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        vscode.postMessage({
          command: "saveName",
          name: input?.value ?? ""
        });
      });

      ${themeDropdownScript}

      input?.focus();
    </script>
  </body>
</html>`;
  }

  private getPetHtml(snapshot: PetSnapshot): string {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const theme = this.getThemeOption(snapshot.theme);
    const colorMode = this.getColorModeTokens(snapshot.colorMode);
    const modeToggleMarkup = this.getModeToggleMarkup(snapshot.colorMode);
    const themeToggleMarkup = this.getThemeToggleMarkup(snapshot.theme);
    const themeDropdownScript = this.getThemeDropdownScript();
    const cspSource = this.view?.webview.cspSource ?? "";
    const comicMonoFontUri = this.getComicMonoFontUri();
    const stats = [
      { label: "Happiness", value: snapshot.happiness, tone: "warm" },
      { label: "Energy", value: snapshot.energy, tone: "cool" },
      { label: "Hunger", value: 100 - snapshot.hunger, tone: "mint" }
    ];

    const statsMarkup = stats
      .map((stat) => {
        return `
          <div class="stat-card">
            <div class="stat-row">
              <span>${stat.label}</span>
              <span>${stat.value}%</span>
            </div>
            <div class="meter">
              <div class="meter-fill ${stat.tone}" style="width: ${stat.value}%"></div>
            </div>
          </div>
        `;
      })
      .join("");

    const moodLabel = snapshot.mood.charAt(0).toUpperCase() + snapshot.mood.slice(1);
    const nextLevelXp = this.requiredXpForNextLevel();
    const contributionMarkup = snapshot.contributions
      .map((day) => {
        const todayClass = day.isToday ? " today" : "";
        const title = `${day.dateKey}: ${day.count} save${day.count === 1 ? "" : "s"}`;
        return `<div class="grass-cell level-${day.level}${todayClass}" title="${title}" aria-label="${title}"></div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Code Buddy Pet</title>
    <style>
      @font-face {
        font-family: "Comic Mono";
        src: url("${comicMonoFontUri}") format("truetype");
        font-display: swap;
      }

      :root {
        color-scheme: light dark;
        --bg-gradient: ${theme.background};
        --panel: ${theme.panel};
        --panel-border: rgba(255, 255, 255, 0.24);
        --text: ${colorMode.text};
        --muted: ${colorMode.muted};
        --button-bg: rgba(255, 255, 255, 0.18);
        --button-border: rgba(255, 255, 255, 0.22);
        --shadow: rgba(0, 0, 0, 0.18);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--text);
        font-family: "Comic Mono", var(--vscode-font-family), monospace;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.35), transparent 42%),
          var(--bg-gradient);
      }

      .shell {
        min-height: 100vh;
        padding: 12px;
      }

      .card {
        display: grid;
        gap: 12px;
        padding: 14px;
        border-radius: 20px;
        background: var(--panel);
        border: 1px solid var(--panel-border);
        box-shadow: 0 16px 40px var(--shadow);
        backdrop-filter: blur(12px);
      }

      .card-topbar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .title-wrap {
        display: grid;
        gap: 4px;
      }

      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .name {
        font-size: 22px;
        font-weight: 700;
      }

      .level-pill {
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        background: rgba(255, 255, 255, 0.18);
      }

      .pet-stage {
        position: relative;
        display: grid;
        place-items: center;
        min-height: 172px;
        padding: 14px;
        border-radius: 18px;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.45), transparent 45%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.08));
        overflow: hidden;
      }

      .pet-stage::after {
        content: "";
        position: absolute;
        width: 110px;
        height: 18px;
        bottom: 14px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.12);
        filter: blur(8px);
      }

      .pet-image {
        max-width: min(100%, 180px);
        max-height: 140px;
        object-fit: contain;
        position: relative;
        z-index: 1;
        animation: floaty 2.7s ease-in-out infinite;
      }

      .garden {
        display: grid;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.08);
      }

      .garden-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 11px;
        color: var(--muted);
        text-transform: uppercase;
      }

      .garden-count {
        color: var(--text);
        font-size: 12px;
      }

      .garden-grid {
        display: grid;
        grid-auto-flow: column;
        grid-template-rows: repeat(7, 10px);
        grid-auto-columns: 10px;
        gap: 4px;
        justify-content: flex-start;
      }

      .grass-cell {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }

      .grass-cell.level-1 {
        background: #b8f279;
      }

      .grass-cell.level-2 {
        background: #7fda63;
      }

      .grass-cell.level-3 {
        background: #34b45a;
      }

      .grass-cell.level-4 {
        background: #0c7a43;
      }

      .grass-cell.today {
        outline: 1px solid rgba(255, 255, 255, 0.72);
        outline-offset: 1px;
      }

      .summary {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.08);
      }

      .summary-block {
        display: grid;
        gap: 4px;
      }

      .summary-label {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--muted);
      }

      .summary-value {
        font-size: 18px;
        font-weight: 700;
      }

      .stat-grid {
        display: grid;
        gap: 10px;
      }

      .stat-card {
        display: grid;
        gap: 6px;
      }

      .stat-row {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
      }

      .meter {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.18);
      }

      .meter-fill {
        height: 100%;
        border-radius: inherit;
      }

      .warm {
        background: linear-gradient(90deg, #ff9a62, #ffd36e);
      }

      .cool {
        background: linear-gradient(90deg, #6fb6ff, #8ae6ff);
      }

      .mint {
        background: linear-gradient(90deg, #68d58c, #c5ff99);
      }

      .button-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .button-grid.triple {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      button {
        border: 1px solid var(--button-border);
        background: var(--button-bg);
        color: inherit;
        border-radius: 12px;
        padding: 10px 12px;
        cursor: pointer;
        font: inherit;
      }

      button:hover {
        background: rgba(255, 255, 255, 0.25);
      }

      .mode-toggle {
        display: inline-flex;
        gap: 4px;
        padding: 3px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.16);
      }

      .mode-option {
        border: 0;
        background: transparent;
        border-radius: 999px;
        min-height: 32px;
        padding: 7px 12px;
      }

      .mode-option.active {
        background: rgba(255, 255, 255, 0.34);
      }

      .theme-dropdown {
        position: relative;
      }

      .theme-split-button {
        display: inline-flex;
      }

      .theme-current,
      .theme-caret {
        min-height: 38px;
        border-color: rgba(255, 255, 255, 0.34);
        background: rgba(255, 255, 255, 0.18);
      }

      .theme-current {
        border-radius: 12px 0 0 12px;
        border-right-width: 0;
        padding: 9px 12px;
      }

      .theme-caret {
        border-radius: 0 12px 12px 0;
        width: 40px;
        padding: 0;
      }

      .theme-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 10;
        min-width: 176px;
        display: none;
        padding: 8px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: rgba(28, 28, 28, 0.22);
        backdrop-filter: blur(14px);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
      }

      .theme-dropdown[data-open] .theme-menu {
        display: grid;
        gap: 6px;
      }

      .theme-option {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 40px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid transparent;
        background: rgba(255, 255, 255, 0.08);
        text-align: left;
      }

      .theme-option:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      .theme-option.active {
        border-color: rgba(255, 255, 255, 0.45);
        background: rgba(255, 255, 255, 0.2);
      }

      .theme-swatch {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        flex-shrink: 0;
        border: 1px solid rgba(255, 255, 255, 0.32);
        background-size: cover;
        background-position: center;
      }

      .fine-print {
        margin: 0;
        font-size: 12px;
        color: var(--muted);
        line-height: 1.45;
      }

      @keyframes floaty {
        0% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
        100% { transform: translateY(0); }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <div class="card-topbar">
          ${modeToggleMarkup}
          ${themeToggleMarkup}
        </div>

        <div class="header">
          <div class="title-wrap">
            <div class="eyebrow">Code Buddy</div>
            <div class="name">${escapeHtml(snapshot.name)}</div>
          </div>
          <div class="level-pill">Lv ${snapshot.level}</div>
        </div>

        <div class="pet-stage">
          <img class="pet-image" src="${snapshot.imageUri}" alt="${escapeHtml(snapshot.name)}" />
        </div>

        <div class="garden">
          <div class="garden-header">
            <span>Save Garden</span>
            <span class="garden-count">${snapshot.todaySaves} save${snapshot.todaySaves === 1 ? "" : "s"} today</span>
          </div>
          <div class="garden-grid">${contributionMarkup}</div>
        </div>

        <div class="summary">
          <div class="summary-block">
            <div class="summary-label">Mood</div>
            <div class="summary-value">${moodLabel}</div>
          </div>
          <div class="summary-block">
            <div class="summary-label">XP</div>
            <div class="summary-value">${snapshot.xp} / ${nextLevelXp}</div>
          </div>
        </div>

        <div class="stat-grid">${statsMarkup}</div>

        <div class="button-grid">
          <button data-command="pet">Pet</button>
          <button data-command="feed">Feed</button>
          <button data-command="play">Play</button>
          <button data-command="nap">Nap</button>
        </div>

        <div class="button-grid triple">
          <button data-command="rename">Rename</button>
          <button data-command="openAssets">Open Assets</button>
          <button data-command="reset">Reset</button>
        </div>

        <p class="fine-print">
          Save files to earn XP. Replace the placeholder images in <strong>media/states</strong> with your own character art.
        </p>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      ${themeDropdownScript}

      for (const button of document.querySelectorAll("button[data-command]")) {
        button.addEventListener("click", () => {
          vscode.postMessage({ command: button.dataset.command });
        });
      }
    </script>
  </body>
</html>`;
  }

  private async savePetName(name?: string): Promise<void> {
    const nextName = (name ?? "").trim();
    if (!nextName) {
      void vscode.window.showWarningMessage("Please enter a name for your pet.");
      return;
    }

    this.state.name = nextName;
    await this.context.globalState.update(STATE_KEY, this.state);
    await this.context.globalState.update(NAME_CONFIRMED_KEY, true);
    await vscode.workspace
      .getConfiguration("codeBuddyPet")
      .update("petName", nextName, vscode.ConfigurationTarget.Global);
    void vscode.window.setStatusBarMessage(`${nextName} is ready to code with you.`, 2500);
    this.render();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PetPanelProvider(context);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider("codeBuddyPet.view", provider),
    vscode.commands.registerCommand("codeBuddyPet.openPetView", async () => {
      await vscode.commands.executeCommand("codeBuddyPet.view.focus");
    }),
    vscode.commands.registerCommand("codeBuddyPet.feedPet", () => provider.feed()),
    vscode.commands.registerCommand("codeBuddyPet.playWithPet", () => provider.play()),
    vscode.commands.registerCommand("codeBuddyPet.letPetNap", () => provider.nap()),
    vscode.commands.registerCommand("codeBuddyPet.petPet", () => provider.pet()),
    vscode.commands.registerCommand("codeBuddyPet.resetPet", () => provider.reset()),
    vscode.commands.registerCommand("codeBuddyPet.openAssetFolder", () => provider.openAssetFolder()),
    vscode.workspace.onDidSaveTextDocument(() => provider.recordSaveActivity()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codeBuddyPet")) {
        provider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  // No-op
}
