import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap, } from '@codemirror/view';
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap, } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Awareness } from 'y-protocols/awareness';
import { getUserColor } from './username';
export function createEditor(config) {
    const { container, roomId, username, wsUrl, initialTheme, onFocus, onBlur, onKeystroke } = config;
    // Theme compartment for dynamic theme switching
    const themeCompartment = new Compartment();
    // Create Y.js document
    const ydoc = new Y.Doc();
    // Create awareness before provider
    const awareness = new Awareness(ydoc);
    // Create Hocuspocus provider with our awareness
    const provider = new HocuspocusProvider({
        url: wsUrl,
        name: roomId,
        document: ydoc,
        awareness: awareness,
    });
    const ytext = ydoc.getText('codemirror');
    // Set initial awareness state (y-codemirror.next expects 'name' and 'color')
    const color = getUserColor(username);
    awareness.setLocalStateField('user', {
        name: username,
        color: color,
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
            themeCompartment.of(initialTheme),
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
    // Update function for username changes
    const updateUsername = (newUsername) => {
        const newColor = getUserColor(newUsername);
        awareness.setLocalStateField('user', {
            name: newUsername,
            color: newColor,
        });
    };
    // Cleanup function
    const destroy = () => {
        view.destroy();
        provider.disconnect();
        ydoc.destroy();
    };
    // Theme switching function
    const setTheme = (theme) => {
        view.dispatch({
            effects: themeCompartment.reconfigure(theme),
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
