// main.js — Electron Main Process
// This creates the invisible "ghost" window that floats on top of everything
// but is completely hidden from screen sharing / screen recording.

const { app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer } = require('electron');
const path = require('path');
require('dotenv').config();

// FIX: Disable hardware acceleration to prevent black/glitchy backgrounds on some Windows machines when capturing transparent windows
app.disableHardwareAcceleration();

let mainWindow = null;
let isQuitting = false;

// ─── Window Mode State ──────────────────────────────────────────────────
const WIN_MODES = {
    FULL: { width: 420, height: 680 },
    MINI: { width: 420, height: 150 },
    TELEPROMPTER: { width: 0, height: 32 }, // width set to screen width at runtime
};
let currentMode = 'FULL';
let savedFullPosition = null; // remembers position when switching to mini/teleprompter

function createWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Window dimensions
    const winWidth = 420;
    const winHeight = 680;

    mainWindow = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: screenWidth - winWidth - 20,
        y: Math.round((screenHeight - winHeight) / 2),
        frame: false,                    // Remove the standard window frame
        transparent: true,               // Make background transparent
        alwaysOnTop: true,               // Float on top of all windows
        resizable: false,                // ★ FIX: Disable resizing so the double-arrow cursor doesn't appear when hovering edges
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        show: false,                     // ★ FIX: Don't show until ready to prevent initial flash
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // ★ THE MAGIC LINE ★
    // This makes the window completely invisible to screen recording and screen sharing!
    mainWindow.setContentProtection(true);

    // Keep on top with the highest priority (above Zoom, Teams, etc.)
    mainWindow.setAlwaysOnTop(true, 'screen-saver');

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // ★ FIX: Show window only after content is ready + protection is applied.
    // This prevents the initial "flash" of unprotected content.
    mainWindow.once('ready-to-show', () => {
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.show();
    });

    // ★ FIX: Re-apply content protection on every window state change.
    // Windows sometimes drops the WDA_EXCLUDEFROMCAPTURE flag on focus/restore/maximize events.
    mainWindow.on('focus', () => {
        mainWindow.setContentProtection(true);
    });
    mainWindow.on('restore', () => {
        mainWindow.setContentProtection(true);
    });
    mainWindow.on('maximize', () => {
        mainWindow.setContentProtection(true);
    });
    mainWindow.on('unmaximize', () => {
        mainWindow.setContentProtection(true);
    });

    // Prevent the window from being closed, just hide it to the tray
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });
}

// Tray icon removed — app is fully invisible in Windows

// ─── IPC Handlers ───────────────────────────────────────────────────────
ipcMain.handle('get-env', () => {
    return {
        DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || '',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        VERTEX_API_KEY: process.env.VERTEX_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || '',
        GROQ_API_KEY: process.env.GROQ_API_KEY || '',
        COHERE_API_KEY: process.env.COHERE_API_KEY || '',
        MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || '',
        TOGETHER_API_KEY: process.env.TOGETHER_API_KEY || '',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    };
});

ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    return sources.map(s => ({ id: s.id, name: s.name }));
});

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-close', () => mainWindow.hide());
ipcMain.on('window-toggle-pin', (event, shouldPin) => {
    mainWindow.setAlwaysOnTop(shouldPin, 'screen-saver');
});

// ─── Mode Switching IPC ─────────────────────────────────────────────────
ipcMain.on('window-set-mode', (event, mode) => {
    if (!mainWindow || !WIN_MODES[mode]) return;
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

    // Save full-mode position before switching away
    if (currentMode === 'FULL' && mode !== 'FULL') {
        savedFullPosition = mainWindow.getBounds();
    }

    const dims = WIN_MODES[mode];

    // Allow resize temporarily to change bounds
    mainWindow.setResizable(true);

    if (mode === 'TELEPROMPTER') {
        mainWindow.setBounds({ x: 0, y: 0, width: screenWidth, height: dims.height });
    } else if (mode === 'MINI') {
        const currentBounds = mainWindow.getBounds();
        // Position mini-mode at top-center of screen (near webcam)
        const miniX = Math.round((screenWidth - dims.width) / 2);
        mainWindow.setBounds({ x: miniX, y: 20, width: dims.width, height: dims.height });
    } else if (mode === 'FULL' && savedFullPosition) {
        mainWindow.setBounds(savedFullPosition);
        savedFullPosition = null;
    } else {
        const currentBounds = mainWindow.getBounds();
        mainWindow.setBounds({ x: currentBounds.x, y: currentBounds.y, width: dims.width, height: dims.height });
    }

    mainWindow.setResizable(false);
    currentMode = mode;

    // Re-apply stealth after bounds change
    mainWindow.setContentProtection(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
});

// ─── App Lifecycle ──────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    const { dialog } = require('electron');
    dialog.showErrorBox('Already Running', 'EliteCODE is already running in the background. Use Ctrl+Shift+P to toggle visibility.');
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should just focus our existing window.
        if (mainWindow) {
            if (!mainWindow.isVisible()) {
                mainWindow.show();
                mainWindow.setContentProtection(true);
            }
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();

        // 🛑 TRAY ICON REMOVED to make the app 100% invisible in Windows.
        // It will no longer show up in the bottom right corner.

        // Global shortcut to completely KILL the app: Ctrl+Shift+Q
        globalShortcut.register('CommandOrControl+Shift+Q', () => {
            isQuitting = true;
            app.quit();
        });

        // ─── PANIC KEY ─── F2 = instant toggle visibility (single key, one finger)
        globalShortcut.register('F2', () => {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.setContentProtection(true);
            }
        });

        // Global shortcut to toggle visibility: Ctrl+Shift+P
        globalShortcut.register('CommandOrControl+Shift+P', () => {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
                // FIX: Re-apply protection
                mainWindow.setContentProtection(true);
            }
        });

        // ─── Window Moving Shortcuts (Ctrl + Shift + Arrow) ───
        const moveStep = 40;
        globalShortcut.register('CommandOrControl+Shift+Up', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const [x, y] = mainWindow.getPosition();
                mainWindow.setPosition(x, y - moveStep);
            }
        });
        globalShortcut.register('CommandOrControl+Shift+Down', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const [x, y] = mainWindow.getPosition();
                mainWindow.setPosition(x, y + moveStep);
            }
        });
        globalShortcut.register('CommandOrControl+Shift+Left', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const [x, y] = mainWindow.getPosition();
                mainWindow.setPosition(x - moveStep, y);
            }
        });
        globalShortcut.register('CommandOrControl+Shift+Right', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const [x, y] = mainWindow.getPosition();
                mainWindow.setPosition(x + moveStep, y);
            }
        });

        // ─── Window Resizing Shortcuts (Ctrl + Arrow) ───
        const resizeStep = 40;
        const defaultWidth = 420;
        const defaultHeight = 680;

        globalShortcut.register('CommandOrControl+Alt+Up', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const bounds = mainWindow.getBounds();
                mainWindow.setBounds({
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: Math.max(defaultHeight, bounds.height - resizeStep)
                });
            }
        });
        globalShortcut.register('CommandOrControl+Alt+Down', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
                const bounds = mainWindow.getBounds();
                mainWindow.setBounds({
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: Math.min(screenHeight, bounds.height + resizeStep)
                });
            }
        });
        globalShortcut.register('CommandOrControl+Alt+Left', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const bounds = mainWindow.getBounds();
                mainWindow.setBounds({
                    x: bounds.x,
                    y: bounds.y,
                    width: Math.max(defaultWidth, bounds.width - resizeStep),
                    height: bounds.height
                });
            }
        });
        globalShortcut.register('CommandOrControl+Alt+Right', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
                const bounds = mainWindow.getBounds();
                mainWindow.setBounds({
                    x: bounds.x,
                    y: bounds.y,
                    width: Math.min(screenWidth, bounds.width + resizeStep),
                    height: bounds.height
                });
            }
        });

    });

    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
