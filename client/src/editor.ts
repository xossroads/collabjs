import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import {
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
} from '@codemirror/view';
import {
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldKeymap,
} from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Awareness } from 'y-protocols/awareness';
import { getUserColor, getUserColorLight } from './username';
import { sanitizeRemoteAwareness } from './sanitize';
import { readableTextOn } from './colors';
import type { ThemeDefinition } from './themes';

export interface EditorConfig {
  container: HTMLElement;
  roomId: string;
  username: string;
  // localStorage UUID, broadcast via awareness so the host dashboard can
  // match this user to their activity stats across renames.
  clientId: string;
  wsUrl: string;
  initialTheme: ThemeDefinition;
  onFocus: () => void;
  onBlur: () => void;
  onKeystroke: () => void;
  // Optional: receive Hocuspocus stateless messages broadcast from the
  // server. Used by the host flow for room-level events like "room-nuked".
  onStateless?: (payload: string) => void;
  // Optional: the server refused this connection in onAuthenticate. The
  // reason is the server's permission-denied string (e.g. a deleted room).
  onAuthenticationFailed?: (reason: string) => void;
}

export interface CollabEditor {
  view: EditorView;
  provider: HocuspocusProvider;
  ydoc: Y.Doc;
  awareness: Awareness;
  destroy: () => void;
  updateUsername: (username: string) => void;
  setTheme: (theme: ThemeDefinition) => void;
}

export function createEditor(config: EditorConfig): CollabEditor {
  const { container, roomId, username, clientId, wsUrl, initialTheme, onFocus, onBlur, onKeystroke, onStateless, onAuthenticationFailed } = config;

  // Theme compartment for dynamic theme switching
  const themeCompartment = new Compartment();

  // Create Y.js document
  const ydoc = new Y.Doc();

  // Create awareness before provider
  const awareness = new Awareness(ydoc);

  // Must be registered before yCollab: its 'change' listener renders remote
  // carets synchronously from the raw states, so they have to be clean first.
  const remoteSanitizer = sanitizeRemoteAwareness(awareness, initialTheme.isDark);

  // Create Hocuspocus provider with our awareness
  const provider = new HocuspocusProvider({
    url: wsUrl,
    name: roomId,
    document: ydoc,
    awareness: awareness,
    onStateless: onStateless
      ? ({ payload }) => onStateless(payload)
      : undefined,
    onAuthenticationFailed: onAuthenticationFailed
      ? ({ reason }) => onAuthenticationFailed(reason)
      : undefined,
  });

  const ytext = ydoc.getText('codemirror');

  // Set initial awareness state (y-codemirror.next expects 'name' and 'color')
  awareness.setLocalStateField('user', {
    name: username,
    color: getUserColor(username),
    colorLight: getUserColorLight(username),
    clientId: clientId,
  });

  // Track keystrokes extension
  const keystrokeTracker = EditorView.domEventHandlers({
    keydown: () => {
      onKeystroke();
      return false;
    },
  });

  // Focus tracking extension
  const focusTracker = EditorView.domEventHandlers({
    focus: () => {
      onFocus();
      return false;
    },
    blur: () => {
      onBlur();
      return false;
    },
  });

  // Custom setup without autocompletion
  const editorSetup = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
  ];

  // Create editor state with yCollab for collaboration
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      editorSetup,
      javascript(),
      themeCompartment.of(initialTheme.extension),
      yCollab(ytext, awareness, { undoManager: new Y.UndoManager(ytext) }),
      keystrokeTracker,
      focusTracker,
    ],
  });

  // Create editor view
  const view = new EditorView({
    state,
    parent: container,
  });

  // yCollab draws each remote caret's name label with fixed white text, which
  // is unreadable on light user colors (yellow, cyan, green). Give each label
  // whichever of dark/white text contrasts more with its caret color. Labels
  // are recreated whenever a caret's color changes, so watching for added
  // nodes is enough. (CodeMirror ignores mutations inside widgets.)
  const labelObserver = new MutationObserver(() => {
    view.contentDOM.querySelectorAll<HTMLElement>('.cm-ySelectionInfo').forEach((info) => {
      const caretColor = info.parentElement?.style.backgroundColor;
      if (!caretColor) return;
      const text = readableTextOn(caretColor);
      if (info.dataset.textOn !== caretColor) {
        info.style.color = text;
        info.dataset.textOn = caretColor;
      }
    });
  });
  labelObserver.observe(view.contentDOM, { childList: true, subtree: true });

  // Update function for username changes
  const updateUsername = (newUsername: string) => {
    awareness.setLocalStateField('user', {
      name: newUsername,
      color: getUserColor(newUsername),
      colorLight: getUserColorLight(newUsername),
      clientId: clientId,
    });
  };

  // Cleanup function
  const destroy = () => {
    labelObserver.disconnect();
    view.destroy();
    provider.disconnect();
    ydoc.destroy();
  };

  // Theme switching function
  const setTheme = (theme: ThemeDefinition) => {
    // Re-light remote users' colors first; the reconfigure below makes
    // yCollab rebuild its caret/selection decorations from them.
    remoteSanitizer.setEditorDark(theme.isDark);
    view.dispatch({
      effects: themeCompartment.reconfigure(theme.extension),
    });
  };

  return {
    view,
    provider,
    ydoc,
    awareness,
    destroy,
    updateUsername,
    setTheme,
  };
}
