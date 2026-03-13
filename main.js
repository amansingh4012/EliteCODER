// main.js — Electron Main Process
// This creates the invisible "ghost" window that floats on top of everything
// but is completely hidden from screen sharing / screen recording.

const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen, desktopCapturer } = require('electron');
const path = require('path');
require('dotenv').config();

// FIX: Disable hardware acceleration to prevent black/glitchy backgrounds on some Windows machines when capturing transparent windows
app.disableHardwareAcceleration();

let mainWindow = null;
let tray = null;
let isRecording = false;

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
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });
}

function createTray() {
    // We use a simple text-based approach if no icon is available
    tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show / Hide',
            click: () => {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                    // FIX: Re-apply protection after every show(). Electron sometimes drops this flag when hiding a window on Windows!
                    mainWindow.setContentProtection(true);
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ]);
    tray.setToolTip('Windows Security Health Service');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            // FIX: Re-apply protection
            mainWindow.setContentProtection(true);
        }
    });
}

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

// ─── App Lifecycle ──────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
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
            app.isQuitting = true;
            app.quit();
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

        globalShortcut.register('CommandOrControl+Up', () => {
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
        globalShortcut.register('CommandOrControl+Down', () => {
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
        globalShortcut.register('CommandOrControl+Left', () => {
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
        globalShortcut.register('CommandOrControl+Right', () => {
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
