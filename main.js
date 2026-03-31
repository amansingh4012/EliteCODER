// main.js — Electron Main Process
// This creates the invisible "ghost" window that floats on top of everything
// but is completely hidden from screen sharing / screen recording.

const { app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer } = require('electron');
const path = require('path');
require('dotenv').config();

// ★ CRITICAL FIX: Do NOT use app.disableHardwareAcceleration()!
// It breaks setContentProtection(true) on Windows by preventing the DWM from
// applying WDA_EXCLUDEFROMCAPTURE. Instead, use a targeted GPU compositing flag
// that fixes transparent window rendering WITHOUT breaking content protection.
app.commandLine.appendSwitch('disable-gpu-compositing');

let mainWindow = null;
let isQuitting = false;
let stealthMode = true; // ★ STEALTH MODE: Window is non-focusable + click-through by default
let contentProtectionTimer = null; // Periodic re-enforcement timer

// ─── Window Mode State ──────────────────────────────────────────────────
const WIN_MODES = {
    FULL: { width: 420, height: 680 },
    MINI: { width: 420, height: 150 },
    TELEPROMPTER: { width: 0, height: 32 }, // width set to screen width at runtime
};
let currentMode = 'FULL';
let savedFullPosition = null; // remembers position when switching to mini/teleprompter

// ─── Tracked Window State (source of truth — never trust the OS) ────────
// Electron issue #27651: on Windows, every getBounds/setBounds/setPosition
// call on a frameless window adds invisible DWM frame pixels. The ONLY
// reliable fix is to track position & size ourselves and never ask the OS.
let windowState = { x: 0, y: 0, width: 420, height: 680 };

function createWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Window dimensions
    const winWidth = 420;
    const winHeight = 680;
    const winX = screenWidth - winWidth - 20;
    const winY = Math.round((screenHeight - winHeight) / 2);

    // Initialize tracked state
    windowState = { x: winX, y: winY, width: winWidth, height: winHeight };

    mainWindow = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: winX,
        y: winY,
        frame: false,                    // Remove the standard window frame
        transparent: true,               // Make background transparent
        alwaysOnTop: true,               // Float on top of all windows
        resizable: false,                // ★ FIX: Disable resizing so the double-arrow cursor doesn't appear when hovering edges
        skipTaskbar: true,               // ★ NEVER show in taskbar
        hasShadow: false,
        focusable: false,                // ★ STEALTH MODE: Window CANNOT steal focus from browser
        type: 'toolbar',                 // ★ TASKBAR FIX: 'toolbar' type windows have NO taskbar entry on Windows
        backgroundColor: '#00000000',
        show: false,                     // ★ FIX: Don't show until ready to prevent initial flash
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // ★ Paint even when hidden (ensures content protection applies early)
            paintWhenInitiallyHidden: true,
        },
    });

    // ★ THE MAGIC LINE ★
    // This makes the window completely invisible to screen recording and screen sharing!
    // Uses Windows WDA_EXCLUDEFROMCAPTURE via DWM — requires GPU compositing to work.
    mainWindow.setContentProtection(true);

    // Keep on top with the highest priority (above Zoom, Teams, etc.)
    mainWindow.setAlwaysOnTop(true, 'screen-saver');

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // ★ FIX: Show window only after content is ready + protection is applied.
    // This prevents the initial "flash" of unprotected content.
    mainWindow.once('ready-to-show', () => {
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setFocusable(!stealthMode); // Apply stealth state
        mainWindow.setSkipTaskbar(true); // ★ NEVER show in taskbar

        // ★ ANTI-TAB-DETECT: In stealth mode, make window click-through by default.
        // Mouse events are forwarded so CSS :hover and mouseenter/mouseleave still fire.
        // The renderer toggles mouse events on/off via IPC when mouse enters/leaves.
        if (stealthMode) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        }

        // Show WITHOUT focusing — critical! showInactive() prevents any focus shift.
        mainWindow.showInactive();

        // ★ PERIODIC CONTENT PROTECTION: Windows can silently drop the
        // WDA_EXCLUDEFROMCAPTURE flag on window state changes. Re-apply every 3 seconds.
        contentProtectionTimer = setInterval(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setContentProtection(true);
            }
        }, 3000);
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
    mainWindow.on('show', () => {
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setSkipTaskbar(true); // ★ NEVER show in taskbar
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

// ─── Stealth Mode IPC ──────────────────────────────────────────────────
ipcMain.handle('get-stealth-mode', () => stealthMode);

ipcMain.on('set-stealth-mode', (event, enabled) => {
    stealthMode = enabled;
    if (mainWindow) {
        mainWindow.setFocusable(!stealthMode);
        mainWindow.setSkipTaskbar(true); // ★ NEVER show in taskbar
        if (stealthMode) {
            // ★ ANTI-TAB-DETECT: Re-entering stealth:
            // 1. Make window click-through (mouse passes to browser)
            // 2. Remove focus so browser gets it back
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
            mainWindow.blur();
        } else {
            // Exiting stealth: allow normal interaction but NEVER focus
            // .focus() can briefly flash the window on the taskbar
            mainWindow.setIgnoreMouseEvents(false);
        }
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setSkipTaskbar(true); // ★ Re-enforce after state changes
        // Notify renderer of the state change
        mainWindow.webContents.send('stealth-mode-changed', stealthMode);
    }
});

// ─── Click-Through IPC (Anti-Tab-Detect System) ────────────────────────
// The renderer detects mouse enter/leave via forwarded events and toggles
// whether the window captures mouse events. This way:
// - Mouse OUTSIDE EliteCODE → clicks go to browser (no focus loss)
// - Mouse INSIDE EliteCODE → clicks go to EliteCODE (but focusable=false prevents focus steal)
ipcMain.on('mouse-enter-window', () => {
    if (stealthMode && mainWindow && !mainWindow.isDestroyed()) {
        // Enable mouse events so user can interact with EliteCODE UI
        mainWindow.setIgnoreMouseEvents(false);
    }
});

ipcMain.on('mouse-leave-window', () => {
    if (stealthMode && mainWindow && !mainWindow.isDestroyed()) {
        // Back to click-through — all clicks pass to the browser
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
});

// ─── Mode Switching IPC ─────────────────────────────────────────────────
ipcMain.on('window-set-mode', (event, mode) => {
    if (!mainWindow || !WIN_MODES[mode]) return;
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

    // Save full-mode position before switching away
    if (currentMode === 'FULL' && mode !== 'FULL') {
        savedFullPosition = { ...windowState };
    }

    const dims = WIN_MODES[mode];

    // Allow resize temporarily to change bounds
    mainWindow.setResizable(true);

    if (mode === 'TELEPROMPTER') {
        windowState = { x: 0, y: 0, width: screenWidth, height: dims.height };
        mainWindow.setBounds(windowState);
    } else if (mode === 'MINI') {
        const miniX = Math.round((screenWidth - dims.width) / 2);
        windowState = { x: miniX, y: 20, width: dims.width, height: dims.height };
        mainWindow.setBounds(windowState);
    } else if (mode === 'FULL' && savedFullPosition) {
        windowState = { ...savedFullPosition };
        mainWindow.setBounds(windowState);
        savedFullPosition = null;
    } else {
        windowState = { ...windowState, width: dims.width, height: dims.height };
        mainWindow.setBounds(windowState);
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
        // Someone tried to run a second instance — show ours without focusing
        if (mainWindow) {
            if (!mainWindow.isVisible()) {
                mainWindow.showInactive();
                mainWindow.setContentProtection(true);
            }
            if (mainWindow.isMinimized()) mainWindow.restore();
            // ★ NEVER call .focus() — it can flash the window onto the taskbar
            mainWindow.setSkipTaskbar(true);
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
                // ★ ALWAYS use showInactive() — .show()/.focus() can flash taskbar
                mainWindow.showInactive();
                if (stealthMode) {
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                }
                mainWindow.setContentProtection(true);
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
                mainWindow.setSkipTaskbar(true); // ★ Re-enforce after show
            }
        });

        // ─── STEALTH TOGGLE ─── F4 = toggle stealth mode (for when you need to type)
        globalShortcut.register('F4', () => {
            stealthMode = !stealthMode;
            if (mainWindow) {
                mainWindow.setFocusable(!stealthMode);
                mainWindow.setSkipTaskbar(true); // ★ NEVER show in taskbar
                if (stealthMode) {
                    // ★ Re-entering stealth: click-through + blur
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                    mainWindow.blur();
                } else {
                    // Exiting stealth: allow normal interaction but NEVER focus
                    mainWindow.setIgnoreMouseEvents(false);
                }
                mainWindow.setContentProtection(true);
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
                mainWindow.setSkipTaskbar(true); // ★ Re-enforce after state changes
                mainWindow.webContents.send('stealth-mode-changed', stealthMode);
            }
        });

        // Global shortcut to toggle visibility: Ctrl+Shift+P
        globalShortcut.register('CommandOrControl+Shift+P', () => {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                // ★ ALWAYS use showInactive() — .show()/.focus() can flash taskbar
                mainWindow.showInactive();
                if (stealthMode) {
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                }
                mainWindow.setContentProtection(true);
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
                mainWindow.setSkipTaskbar(true); // ★ Re-enforce after show
            }
        });

        // ─── Window Moving Shortcuts (Ctrl + Shift + Arrow) ─────────────
        //
        // ARCHITECTURE: We never ask the OS for position or size.
        // We track windowState ourselves (the ONLY source of truth).
        // On each move:
        //   1. Update our tracked position
        //   2. Lock size with setMinimumSize + setMaximumSize (OS physically
        //      cannot change the size, even if DWM tries)
        //   3. setBounds with our known-good values
        //   4. Unlock size constraints and re-lock resizable
        //
        // This is the definitive workaround for Electron issue #27651.

        const moveStep = 40;

        function moveWindow(dx, dy) {
            if (!mainWindow || !mainWindow.isVisible()) return;

            // Update our tracked position (source of truth)
            windowState.x += dx;
            windowState.y += dy;

            // Lock the size so the OS physically cannot alter it
            mainWindow.setResizable(true);
            mainWindow.setMinimumSize(windowState.width, windowState.height);
            mainWindow.setMaximumSize(windowState.width, windowState.height);

            // Apply our known-good bounds
            mainWindow.setBounds({
                x: windowState.x,
                y: windowState.y,
                width: windowState.width,
                height: windowState.height
            });

            // Unlock size constraints (so resize shortcuts still work)
            mainWindow.setMinimumSize(0, 0);
            mainWindow.setMaximumSize(99999, 99999);
            mainWindow.setResizable(false);
        }

        globalShortcut.register('CommandOrControl+Shift+Up', () => moveWindow(0, -moveStep));
        globalShortcut.register('CommandOrControl+Shift+Down', () => moveWindow(0, moveStep));
        globalShortcut.register('CommandOrControl+Shift+Left', () => moveWindow(-moveStep, 0));
        globalShortcut.register('CommandOrControl+Shift+Right', () => moveWindow(moveStep, 0));

        // ─── Window Resizing Shortcuts (Ctrl + Arrow) ───────────────────
        const resizeStep = 40;

        globalShortcut.register('CommandOrControl+Up', () => {
            if (mainWindow && mainWindow.isVisible()) {
                windowState.height = Math.max(WIN_MODES.FULL.height, windowState.height - resizeStep);
                mainWindow.setResizable(true);
                mainWindow.setContentBounds(windowState);
                mainWindow.setResizable(false);
            }
        });
        globalShortcut.register('CommandOrControl+Down', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
                windowState.height = Math.min(screenHeight, windowState.height + resizeStep);
                mainWindow.setResizable(true);
                mainWindow.setContentBounds(windowState);
                mainWindow.setResizable(false);
            }
        });
        globalShortcut.register('CommandOrControl+Left', () => {
            if (mainWindow && mainWindow.isVisible()) {
                windowState.width = Math.max(WIN_MODES.FULL.width, windowState.width - resizeStep);
                mainWindow.setResizable(true);
                mainWindow.setContentBounds(windowState);
                mainWindow.setResizable(false);
            }
        });
        globalShortcut.register('CommandOrControl+Right', () => {
            if (mainWindow && mainWindow.isVisible()) {
                const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
                windowState.width = Math.min(screenWidth, windowState.width + resizeStep);
                mainWindow.setResizable(true);
                mainWindow.setContentBounds(windowState);
                mainWindow.setResizable(false);
            }
        });

    });

    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
        if (contentProtectionTimer) {
            clearInterval(contentProtectionTimer);
            contentProtectionTimer = null;
        }
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
