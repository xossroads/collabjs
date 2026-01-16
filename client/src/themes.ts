import { Extension } from '@codemirror/state';

// Official CodeMirror theme
import { oneDark } from '@codemirror/theme-one-dark';

// @uiw themes
import { abcdef } from '@uiw/codemirror-theme-abcdef';
import { abyss } from '@uiw/codemirror-theme-abyss';
import { androidstudio } from '@uiw/codemirror-theme-androidstudio';
import { andromeda } from '@uiw/codemirror-theme-andromeda';
import { atomone } from '@uiw/codemirror-theme-atomone';
import { aura } from '@uiw/codemirror-theme-aura';
import { bbedit } from '@uiw/codemirror-theme-bbedit';
import { bespin } from '@uiw/codemirror-theme-bespin';
import { copilot } from '@uiw/codemirror-theme-copilot';
import { darcula } from '@uiw/codemirror-theme-darcula';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { duotoneLight, duotoneDark } from '@uiw/codemirror-theme-duotone';
import { eclipse } from '@uiw/codemirror-theme-eclipse';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { gruvboxDark } from '@uiw/codemirror-theme-gruvbox-dark';
import { kimbie } from '@uiw/codemirror-theme-kimbie';
import { material, materialLight, materialDark } from '@uiw/codemirror-theme-material';
import { monokai } from '@uiw/codemirror-theme-monokai';
import { monokaiDimmed } from '@uiw/codemirror-theme-monokai-dimmed';
import { noctisLilac } from '@uiw/codemirror-theme-noctis-lilac';
import { nord } from '@uiw/codemirror-theme-nord';
import { okaidia } from '@uiw/codemirror-theme-okaidia';
import { quietlight } from '@uiw/codemirror-theme-quietlight';
import { red } from '@uiw/codemirror-theme-red';
import { solarizedLight, solarizedDark } from '@uiw/codemirror-theme-solarized';
import { sublime } from '@uiw/codemirror-theme-sublime';
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night';
import { tokyoNightDay } from '@uiw/codemirror-theme-tokyo-night-day';
import { tokyoNightStorm } from '@uiw/codemirror-theme-tokyo-night-storm';
import { tomorrowNightBlue } from '@uiw/codemirror-theme-tomorrow-night-blue';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { whiteLight, whiteDark } from '@uiw/codemirror-theme-white';
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode';

export interface ThemeDefinition {
  id: string;
  name: string;
  extension: Extension;
  isDark: boolean;
}

// Theme registry with all available themes
export const THEMES: ThemeDefinition[] = [
  // Dark themes
  { id: 'one-dark', name: 'One Dark', extension: oneDark, isDark: true },
  { id: 'vscode-dark', name: 'VS Code Dark', extension: vscodeDark, isDark: true },
  { id: 'dracula', name: 'Dracula', extension: dracula, isDark: true },
  { id: 'tokyo-night', name: 'Tokyo Night', extension: tokyoNight, isDark: true },
  { id: 'tokyo-night-storm', name: 'Tokyo Night Storm', extension: tokyoNightStorm, isDark: true },
  { id: 'monokai', name: 'Monokai', extension: monokai, isDark: true },
  { id: 'monokai-dimmed', name: 'Monokai Dimmed', extension: monokaiDimmed, isDark: true },
  { id: 'sublime', name: 'Sublime', extension: sublime, isDark: true },
  { id: 'material-dark', name: 'Material Dark', extension: materialDark, isDark: true },
  { id: 'github-dark', name: 'GitHub Dark', extension: githubDark, isDark: true },
  { id: 'nord', name: 'Nord', extension: nord, isDark: true },
  { id: 'atomone', name: 'Atom One', extension: atomone, isDark: true },
  { id: 'darcula', name: 'Darcula', extension: darcula, isDark: true },
  { id: 'abyss', name: 'Abyss', extension: abyss, isDark: true },
  { id: 'andromeda', name: 'Andromeda', extension: andromeda, isDark: true },
  { id: 'aura', name: 'Aura', extension: aura, isDark: true },
  { id: 'bespin', name: 'Bespin', extension: bespin, isDark: true },
  { id: 'copilot', name: 'Copilot', extension: copilot, isDark: true },
  { id: 'duotone-dark', name: 'Duotone Dark', extension: duotoneDark, isDark: true },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', extension: gruvboxDark, isDark: true },
  { id: 'kimbie', name: 'Kimbie', extension: kimbie, isDark: true },
  { id: 'okaidia', name: 'Okaidia', extension: okaidia, isDark: true },
  { id: 'red', name: 'Red', extension: red, isDark: true },
  { id: 'solarized-dark', name: 'Solarized Dark', extension: solarizedDark, isDark: true },
  { id: 'tomorrow-night-blue', name: 'Tomorrow Night Blue', extension: tomorrowNightBlue, isDark: true },
  { id: 'white-dark', name: 'White Dark', extension: whiteDark, isDark: true },
  { id: 'xcode-dark', name: 'Xcode Dark', extension: xcodeDark, isDark: true },
  { id: 'abcdef', name: 'ABCDEF', extension: abcdef, isDark: true },
  { id: 'androidstudio', name: 'Android Studio', extension: androidstudio, isDark: true },

  // Light themes
  { id: 'github-light', name: 'GitHub Light', extension: githubLight, isDark: false },
  { id: 'tokyo-night-day', name: 'Tokyo Night Day', extension: tokyoNightDay, isDark: false },
  { id: 'material-light', name: 'Material Light', extension: materialLight, isDark: false },
  { id: 'solarized-light', name: 'Solarized Light', extension: solarizedLight, isDark: false },
  { id: 'duotone-light', name: 'Duotone Light', extension: duotoneLight, isDark: false },
  { id: 'eclipse', name: 'Eclipse', extension: eclipse, isDark: false },
  { id: 'quietlight', name: 'Quiet Light', extension: quietlight, isDark: false },
  { id: 'noctis-lilac', name: 'Noctis Lilac', extension: noctisLilac, isDark: false },
  { id: 'bbedit', name: 'BBEdit', extension: bbedit, isDark: false },
  { id: 'white-light', name: 'White Light', extension: whiteLight, isDark: false },
  { id: 'xcode-light', name: 'Xcode Light', extension: xcodeLight, isDark: false },
];

const STORAGE_KEY = 'collabjs-theme';
const DEFAULT_THEME = 'vscode-dark';

export function getThemeById(id: string): ThemeDefinition | undefined {
  return THEMES.find(t => t.id === id);
}

export function getThemeList(): { id: string; name: string; isDark: boolean }[] {
  return THEMES.map(t => ({ id: t.id, name: t.name, isDark: t.isDark }));
}

export function getSavedTheme(): string {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
}

export function saveTheme(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

export function getDefaultTheme(): ThemeDefinition {
  const savedId = getSavedTheme();
  return getThemeById(savedId) || getThemeById(DEFAULT_THEME)!;
}
