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
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import { Awareness } from 'y-protocols/awareness';
import { getUserColor } from './username';
import { createEditorAwareness } from './sanitize';
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
  // Read-only view of `awareness` with remote users cleaned and their colors
  // lit for the current editor theme. Use it to draw anything over the editor.
  editorAwareness: Awareness;
  destroy: () => void;
  // Open a fresh socket, re-running server auth. Used after a temporary
  // denial: the provider never retries a denied connection by itself.
  reconnect: () => void;
  updateUsername: (username: string) => void;
  setTheme: (theme: ThemeDefinition) => void;
}

// yCollab's caret name labels have fixed white text. Remote carets are lit
// light on dark themes and dark on light ones (themedUserColors), so the
// readable label text depends only on the theme: dark text on dark themes,
// white on light. (Measured for every hue; a theme rule outranks yCollab's
// base theme.)
function caretLabelTheme(editorIsDark: boolean) {
  return EditorView.theme({
    '.cm-ySelectionInfo': { color: editorIsDark ? '#1e1e1e' : '#ffffff' },
  });
}

function themeExtensions(theme: ThemeDefinition) {
  return [theme.extension, caretLabelTheme(theme.isDark)];
}

export function createEditor(config: EditorConfig): CollabEditor {
  const { container, roomId, username, clientId, wsUrl, initialTheme, onFocus, onBlur, onKeystroke, onStateless, onAuthenticationFailed } = config;

  // Theme compartment for dynamic theme switching
  const themeCompartment = new Compartment();

  // Create Y.js document
  const ydoc = new Y.Doc();

  // Create awareness before provider
  const awareness = new Awareness(ydoc);

  // yCollab reads peers through this cleaned, theme-lit view.
  const editorAwareness = createEditorAwareness(awareness, initialTheme.isDark);

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
      themeCompartment.of(themeExtensions(initialTheme)),
      yCollab(ytext, editorAwareness.awareness, { undoManager: new Y.UndoManager(ytext) }),
      keystrokeTracker,
      focusTracker,
    ],
  });

  // Create editor view
  const view = new EditorView({
    state,
    parent: container,
  });

  // Update function for username changes
  const updateUsername = (newUsername: string) => {
    awareness.setLocalStateField('user', {
      name: newUsername,
      color: getUserColor(newUsername),
      clientId: clientId,
    });
  };

  // Cleanup function
  const destroy = () => {
    view.destroy();
    provider.disconnect();
    ydoc.destroy();
  };

  // disconnect() only starts closing the socket, and connect() is a no-op
  // while it's still open — so wait for the close before connecting.
  const reconnect = () => {
    if (provider.configuration.websocketProvider.status === WebSocketStatus.Disconnected) {
      provider.connect();
      return;
    }
    const onDisconnect = () => {
      provider.off('disconnect', onDisconnect);
      provider.connect();
    };
    provider.on('disconnect', onDisconnect);
    provider.disconnect();
  };

  // Theme switching function
  const setTheme = (theme: ThemeDefinition) => {
    // Re-light remote users' colors first; the reconfigure below makes
    // yCollab rebuild its caret/selection decorations from them.
    editorAwareness.setEditorDark(theme.isDark);
    view.dispatch({
      effects: themeCompartment.reconfigure(themeExtensions(theme)),
    });
  };

  return {
    view,
    provider,
    ydoc,
    awareness,
    editorAwareness: editorAwareness.awareness,
    destroy,
    reconnect,
    updateUsername,
    setTheme,
  };
}
