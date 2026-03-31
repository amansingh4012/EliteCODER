// ═══════════════════════════════════════════════════════════════════
// Security Health Service — Renderer Process (v2)
// Handles UI, audio, transcription, AI, screen analysis, settings
// ═══════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────
  const state = {
    isListening: false,
    isPinned: true,
    isAIBarOpen: false,
    deepgramSocket: null,
    mediaStream: null,
    mediaRecorder: null,
    mixerAudioContext: null,
    audioContext: null,
    analyserNode: null,
    animationFrameId: null,
    deepgramKeepAliveInterval: null,
    transcript: [],
    aiResponses: [],
    envKeys: { DEEPGRAM_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '' },
    partialTranscript: '',
    transcriptForAI: '',
    lastScreenAnalysisText: '',
    questionDebounce: null,
    demoInterval: null,
    sessionTimerInterval: null,
    sessionStartTime: null,
    activeTab: 'transcript',
    // ─── New Feature State ───
    windowMode: 'FULL',                // 'FULL' | 'MINI' | 'TELEPROMPTER'
    conversationHistory: [],            // last N Q&A pairs for follow-up context
    latestAIAnswer: '',                 // cached for mini-mode display
    autoScreenWatchInterval: null,      // 15s screen capture interval
    lastScreenHash: '',                 // to detect screen content changes
    lastDetectedQuestion: '',           // extracted question text for dedup
    autoScreenBusy: false,              // prevents overlapping auto-screen calls
    lastQuestionType: 'SHORT',          // AUTO-DETECTED: SHORT | CODE | DESIGN | BEHAVIORAL | IMPLEMENTATION
    // Settings
    settings: {
      resume: '',
      jobDescription: '',
      customInstructions: '',
      model: 'gemini-2.5-flash',
      autoDetect: true,
      autoSwitch: true,
      autoScroll: true,
      autoScrollAI: true,
      soundNotifications: false,
      strictCode: true,
      strictCompare: true,
      strictExplain: true,
      detailedMode: false,
      useScreenContext: false,
      captureMic: true,
      autoScreenWatch: false
    },
  };

  // ─── DOM References ─────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const dom = {
    btnStart: $('#btn-start'),
    btnStop: $('#btn-stop'),
    btnAsk: $('#btn-ask'),
    btnScreen: $('#btn-screen'),
    btnPin: $('#btn-pin'),
    btnMinimize: $('#btn-minimize'),
    btnClose: $('#btn-close'),
    btnSettings: $('#btn-settings'),
    btnShortcuts: $('#btn-shortcuts'),
    statusDot: $('#status-dot'),
    statusText: $('#status-text'),
    deepgramStatus: $('#deepgram-status'),
    openaiStatus: $('#openai-status'),
    transcriptContent: $('#transcript-content'),
    aiContent: $('#ai-content'),
    summaryContent: $('#summary-content'),
    screenContent: $('#screen-content'),
    aiInputBar: $('#ai-input-bar'),
    aiInput: $('#ai-input'),
    btnSendAI: $('#btn-send-ai'),
    tabs: $$('.tab'),
    panels: $$('.panel'),
    // Toolbar
    btnExport: $('#btn-export'),
    btnClear: $('#btn-clear'),
    btnCopyAll: $('#btn-copy-all'),
    // Opacity & Timer
    opacitySlider: $('#opacity-slider'),
    sessionTimer: $('#session-timer'),
    badgeAI: $('#badge-ai'),
    // Overlays
    settingsOverlay: $('#settings-overlay'),
    shortcutsOverlay: $('#shortcuts-overlay'),
    btnCloseSettings: $('#btn-close-settings'),
    btnCloseShortcuts: $('#btn-close-shortcuts'),
    btnSaveSettings: $('#btn-save-settings'),
    // Settings inputs
    inputResume: $('#input-resume'),
    inputJobDesc: $('#input-job-desc'),
    inputCustom: $('#input-custom'),
    // Custom dropdown for model selection
    modelDropdown: $('#model-dropdown'),
    modelDropdownTrigger: $('#model-dropdown-trigger'),
    modelDropdownList: document.querySelector('#model-dropdown .custom-dropdown-list'),
    toggleAutodetect: $('#toggle-autodetect'),
    toggleAutoswitch: $('#toggle-autoswitch'),
    toggleAutoscroll: $('#toggle-autoscroll'),
    toggleAutoscrollAI: $('#toggle-autoscroll-ai'),
    toggleSound: $('#toggle-sound'),
    toggleStrictCode: $('#toggle-strict-code'),
    toggleStrictCompare: $('#toggle-strict-compare'),
    toggleStrictExplain: $('#toggle-strict-explain'),
    toggleDetailedMode: $('#toggle-detailed-mode'),
    toggleMic: $('#toggle-mic'),
    toggleScreenContext: $('#toggle-screen-context'),
    toggleAutoscreen: $('#toggle-autoscreen'),
    // Mini-mode
    miniAnswerPanel: $('#mini-answer-panel'),
    miniAnswerContent: $('#mini-answer-content'),
    btnMiniCopy: $('#btn-mini-copy'),
    btnMiniExpand: $('#btn-mini-expand'),
    // Teleprompter
    teleprompterBar: $('#teleprompter-bar'),
    teleprompterText: $('#teleprompter-text'),
  };

  // ─── Initialize ─────────────────────────────────────────────────
  async function init() {
    try {
      state.envKeys = await window.electronAPI.getEnv();
    } catch (e) {
      console.warn('Could not load env keys:', e);
    }

    loadSettings();
    updateAPIStatus();
    bindEvents();
    createAudioVisualizer();

    // ★ ANTI-TAB-DETECT: Click-through mouse tracking.
    // When cursor enters EliteCODE window → enable mouse events (allow interaction)
    // When cursor leaves → re-enable click-through (clicks pass to browser)
    // This works WITH focusable:false to ensure browser NEVER fires blur/visibilitychange
    setupClickThroughTracking();

    showToast('Ready! Press Start to begin.', 'info');
  }

  // ─── Click-Through Mouse Tracking ─────────────────────────────────
  function setupClickThroughTracking() {
    let isInside = false;

    document.addEventListener('mouseenter', () => {
      if (!isInside) {
        isInside = true;
        window.electronAPI.mouseEnterWindow();
      }
    });

    document.addEventListener('mouseleave', () => {
      if (isInside) {
        isInside = false;
        window.electronAPI.mouseLeaveWindow();
      }
    });

    // Listen for stealth mode changes to update the stealth badge
    window.electronAPI.onStealthModeChanged((enabled) => {
      const badge = document.getElementById('stealth-badge');
      if (badge) {
        badge.classList.toggle('stealth-on', enabled);
        badge.classList.toggle('stealth-off', !enabled);
        badge.textContent = enabled ? '👻 STEALTH' : '👁️ VISIBLE';
        // ★ NO title attribute — native OS tooltips are detectable by proctoring tools
      }
    });
  }

  // ─── Event Bindings ─────────────────────────────────────────────
  function bindEvents() {
    // Window controls
    dom.btnMinimize.addEventListener('click', () => window.electronAPI.minimizeWindow());
    dom.btnClose.addEventListener('click', () => window.electronAPI.closeWindow());
    dom.btnPin.addEventListener('click', togglePin);

    // Toolbar settings
    if (dom.toggleScreenContext) {
      dom.toggleScreenContext.addEventListener('change', () => {
        state.settings.useScreenContext = dom.toggleScreenContext.checked;
        saveSettings();
      });
    }

    // Main controls
    dom.btnStart.addEventListener('click', startListening);
    dom.btnStop.addEventListener('click', stopListening);
    dom.btnAsk.addEventListener('click', toggleAIBar);
    dom.btnScreen.addEventListener('click', captureAndAnalyzeScreen);

    // Tabs
    dom.tabs.forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // AI Input
    dom.btnSendAI.addEventListener('click', sendAIQuestion);
    dom.aiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAIQuestion();
    });

    // Settings overlay
    dom.btnSettings.addEventListener('click', () => toggleOverlay('settings'));
    dom.btnCloseSettings.addEventListener('click', () => closeOverlay('settings'));
    dom.btnSaveSettings.addEventListener('click', saveSettings);

    // Shortcuts overlay
    dom.btnShortcuts.addEventListener('click', () => toggleOverlay('shortcuts'));
    dom.btnCloseShortcuts.addEventListener('click', () => closeOverlay('shortcuts'));

    // Toolbar
    dom.btnExport.addEventListener('click', exportTranscript);
    dom.btnClear.addEventListener('click', clearCurrentPanel);
    dom.btnCopyAll.addEventListener('click', copyAllContent);

    // Opacity slider — use CSS filter instead of container opacity to avoid full window recomposition
    dom.opacitySlider.addEventListener('input', (e) => {
      const val = e.target.value / 100;
      document.getElementById('app').style.opacity = val;
    });

    // ── Custom Model Dropdown ──
    if (dom.modelDropdownTrigger) {
      dom.modelDropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.modelDropdown.classList.toggle('open');
      });
    }
    if (dom.modelDropdownList) {
      dom.modelDropdownList.addEventListener('click', (e) => {
        const item = e.target.closest('.custom-dropdown-item');
        if (!item) return;
        const value = item.dataset.value;
        const label = item.textContent;
        dom.modelDropdownTrigger.textContent = label;
        dom.modelDropdownList.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        state.settings.model = value;
        dom.modelDropdown.classList.remove('open');
      });
    }
    document.addEventListener('click', (e) => {
      if (dom.modelDropdown && !dom.modelDropdown.contains(e.target)) {
        dom.modelDropdown.classList.remove('open');
      }
    });

    // ── Mini-Mode Controls ──
    if (dom.btnMiniCopy) {
      dom.btnMiniCopy.addEventListener('click', () => {
        if (state.latestAIAnswer) {
          navigator.clipboard.writeText(state.latestAIAnswer).then(() => showToast('Copied!', 'success'));
        }
      });
    }
    if (dom.btnMiniExpand) {
      dom.btnMiniExpand.addEventListener('click', () => setWindowMode('FULL'));
    }

    // ── Auto Screen Watch Toggle ──
    if (dom.toggleAutoscreen) {
      dom.toggleAutoscreen.addEventListener('change', () => {
        state.settings.autoScreenWatch = dom.toggleAutoscreen.checked;
        saveSettings();
        if (state.settings.autoScreenWatch) {
          startAutoScreenWatch();
        } else {
          stopAutoScreenWatch();
        }
      });
    }

    // ── Click-to-copy on AI answers ──
    dom.aiContent.addEventListener('click', (e) => {
      const answerEl = e.target.closest('.ai-item-answer');
      if (answerEl && !e.target.closest('.item-copy-btn')) {
        const text = answerEl.innerText;
        if (text) {
          navigator.clipboard.writeText(text).then(() => showToast('Answer copied!', 'success'));
        }
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
  }

  // ─── Keyboard Shortcuts ─────────────────────────────────────────
  function handleKeyboardShortcuts(e) {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        closeAllOverlays();
      }
      return;
    }

    if (e.ctrlKey && e.shiftKey) {
      switch (e.key.toUpperCase()) {
        case 'A': // Open AI prompt
          e.preventDefault();
          toggleAIBar();
          break;
        case 'S': // Screen capture
          e.preventDefault();
          captureAndAnalyzeScreen();
          break;
        case 'M': // Toggle Mini-mode
          e.preventDefault();
          setWindowMode(state.windowMode === 'MINI' ? 'FULL' : 'MINI');
          break;
        case 'T': // Toggle Teleprompter
          e.preventDefault();
          setWindowMode(state.windowMode === 'TELEPROMPTER' ? 'FULL' : 'TELEPROMPTER');
          break;
      }
    } else if (e.ctrlKey) {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (state.isListening) stopListening();
          else startListening();
          break;
        case ',':
          e.preventDefault();
          toggleOverlay('settings');
          break;
        case '/':
          e.preventDefault();
          toggleOverlay('shortcuts');
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          exportTranscript();
          break;
        case '1':
          e.preventDefault();
          switchTab('transcript');
          break;
        case '2':
          e.preventDefault();
          switchTab('ai-hints');
          break;
        case '3':
          e.preventDefault();
          switchTab('summary');
          break;
        case '4':
          e.preventDefault();
          switchTab('screen-analysis');
          break;
      }
    }

    if (e.key === 'Escape') {
      closeAllOverlays();
    }
  }

  // ─── Window Mode Switching ─────────────────────────────────────────
  function setWindowMode(mode) {
    state.windowMode = mode;
    window.electronAPI.setWindowMode(mode);

    const fullUI = [
      '#titlebar', '#status-bar', '#audio-visualizer', '#controls',
      '#tabs', '#panel-toolbar', '#panels', '#ai-input-bar', '#footer'
    ];

    if (mode === 'MINI') {
      // Hide full UI, show mini panel
      fullUI.forEach(sel => { const el = document.querySelector(sel); if (el) el.classList.add('hidden'); });
      if (dom.teleprompterBar) dom.teleprompterBar.classList.add('hidden');
      if (dom.miniAnswerPanel) {
        dom.miniAnswerPanel.classList.remove('hidden');
        // Show latest answer
        if (state.latestAIAnswer && dom.miniAnswerContent) {
          dom.miniAnswerContent.innerHTML = parseMarkdown(state.latestAIAnswer);
        }
      }
      showToast('Mini-mode — Ctrl+Shift+M to expand', 'info');
    } else if (mode === 'TELEPROMPTER') {
      // Hide full UI, show teleprompter
      fullUI.forEach(sel => { const el = document.querySelector(sel); if (el) el.classList.add('hidden'); });
      if (dom.miniAnswerPanel) dom.miniAnswerPanel.classList.add('hidden');
      if (dom.teleprompterBar) {
        dom.teleprompterBar.classList.remove('hidden');
        if (state.latestAIAnswer) {
          startTeleprompterScroll(state.latestAIAnswer);
        }
      }
      showToast('Teleprompter — Ctrl+Shift+T to exit', 'info');
    } else {
      // FULL mode — restore everything
      fullUI.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) {
          // Don't unhide buttons that should remain hidden based on state
          if (sel === '#ai-input-bar' && !state.isAIBarOpen) return;
          if (sel === '#audio-visualizer' && !state.isListening) return;
          el.classList.remove('hidden');
        }
      });
      // Restore start/stop button state
      dom.btnStart.classList.toggle('hidden', state.isListening);
      dom.btnStop.classList.toggle('hidden', !state.isListening);
      if (dom.miniAnswerPanel) dom.miniAnswerPanel.classList.add('hidden');
      if (dom.teleprompterBar) dom.teleprompterBar.classList.add('hidden');
    }
  }

  // ─── Teleprompter Scrolling ───────────────────────────────────────
  function startTeleprompterScroll(text) {
    if (!dom.teleprompterText) return;
    // Strip markdown, show plain text
    const plainText = text.replace(/[*#`_~]/g, '').replace(/\n+/g, '  •  ');
    dom.teleprompterText.textContent = plainText;
    // Reset scroll animation
    dom.teleprompterText.style.animation = 'none';
    dom.teleprompterText.offsetHeight; // force reflow
    // Calculate duration based on text length (~40 chars per second reading speed)
    const duration = Math.max(10, Math.round(plainText.length / 40));
    dom.teleprompterText.style.animation = `teleprompterScroll ${duration}s linear infinite`;
  }

  // ─── Window Controls ──────────────────────────────────────────
  function togglePin() {
    state.isPinned = !state.isPinned;
    window.electronAPI.togglePin(state.isPinned);
    dom.btnPin.classList.toggle('pinned', state.isPinned);
    showToast(state.isPinned ? 'Pinned on top' : 'Unpinned', 'info');
  }

  // ─── Tab Switching ──────────────────────────────────────────────
  function switchTab(tabName) {
    state.activeTab = tabName;
    dom.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    dom.panels.forEach(p => {
      const isActive = p.id === `panel-${tabName}`;
      p.classList.toggle('active', isActive);
    });
    // Clear badge if switching to that tab
    if (tabName === 'ai-hints' && dom.badgeAI) {
      dom.badgeAI.classList.add('hidden');
    }
  }

  // ─── Overlay Management ─────────────────────────────────────────
  function toggleOverlay(name) {
    const overlay = name === 'settings' ? dom.settingsOverlay : dom.shortcutsOverlay;
    if (overlay.classList.contains('hidden')) {
      closeAllOverlays();
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }

  function closeOverlay(name) {
    const overlay = name === 'settings' ? dom.settingsOverlay : dom.shortcutsOverlay;
    overlay.classList.add('hidden');
  }

  function closeAllOverlays() {
    dom.settingsOverlay.classList.add('hidden');
    dom.shortcutsOverlay.classList.add('hidden');
  }

  // ─── Settings Management ────────────────────────────────────────
  function loadSettings() {
    try {
      const saved = localStorage.getItem('shs-settings');
      if (saved) {
        Object.assign(state.settings, JSON.parse(saved));
      }
    } catch (e) { /* ignore */ }

    // Apply to UI
    dom.inputResume.value = state.settings.resume;
    dom.inputJobDesc.value = state.settings.jobDescription;
    dom.inputCustom.value = state.settings.customInstructions;

    // Apply model to custom dropdown
    if (dom.modelDropdownList) {
      const items = dom.modelDropdownList.querySelectorAll('.custom-dropdown-item');
      items.forEach(item => {
        item.classList.toggle('selected', item.dataset.value === state.settings.model);
        if (item.dataset.value === state.settings.model) {
          dom.modelDropdownTrigger.textContent = item.textContent;
        }
      });
    }

    dom.toggleAutodetect.checked = state.settings.autoDetect;
    if (dom.toggleAutoswitch) dom.toggleAutoswitch.checked = state.settings.autoSwitch;
    dom.toggleAutoscroll.checked = state.settings.autoScroll;

    if (dom.toggleAutoscrollAI) dom.toggleAutoscrollAI.checked = state.settings.autoScrollAI ?? true;
    if (dom.toggleStrictCode) dom.toggleStrictCode.checked = state.settings.strictCode ?? true;
    if (dom.toggleStrictCompare) dom.toggleStrictCompare.checked = state.settings.strictCompare ?? true;
    if (dom.toggleStrictExplain) dom.toggleStrictExplain.checked = state.settings.strictExplain ?? true;
    if (dom.toggleDetailedMode) dom.toggleDetailedMode.checked = state.settings.detailedMode ?? false;
    if (dom.toggleScreenContext) dom.toggleScreenContext.checked = state.settings.useScreenContext ?? false;
    if (dom.toggleAutoscreen) dom.toggleAutoscreen.checked = state.settings.autoScreenWatch ?? false;

    if (dom.toggleMic) dom.toggleMic.checked = state.settings.captureMic ?? true;

    dom.toggleSound.checked = state.settings.soundNotifications;

    // Start auto screen watch if setting was saved as enabled
    if (state.settings.autoScreenWatch) {
      startAutoScreenWatch();
    }
  }

  function saveSettings() {
    state.settings.resume = dom.inputResume.value.trim();
    state.settings.jobDescription = dom.inputJobDesc.value.trim();
    state.settings.customInstructions = dom.inputCustom.value.trim();
    // Model is already updated by dropdown click handler
    state.settings.autoDetect = dom.toggleAutodetect.checked;
    if (dom.toggleAutoswitch) state.settings.autoSwitch = dom.toggleAutoswitch.checked;
    state.settings.autoScroll = dom.toggleAutoscroll.checked;
    if (dom.toggleAutoscrollAI) state.settings.autoScrollAI = dom.toggleAutoscrollAI.checked;
    if (dom.toggleStrictCode) state.settings.strictCode = dom.toggleStrictCode.checked;
    if (dom.toggleStrictCompare) state.settings.strictCompare = dom.toggleStrictCompare.checked;
    if (dom.toggleStrictExplain) state.settings.strictExplain = dom.toggleStrictExplain.checked;
    if (dom.toggleDetailedMode) state.settings.detailedMode = dom.toggleDetailedMode.checked;
    if (dom.toggleScreenContext) state.settings.useScreenContext = dom.toggleScreenContext.checked;
    if (dom.toggleAutoscreen) state.settings.autoScreenWatch = dom.toggleAutoscreen.checked;
    if (dom.toggleMic) state.settings.captureMic = dom.toggleMic.checked;
    state.settings.soundNotifications = dom.toggleSound.checked;

    try {
      localStorage.setItem('shs-settings', JSON.stringify(state.settings));
    } catch (e) { /* ignore */ }

    closeOverlay('settings');
    showToast('Settings saved!', 'success');
  }

  // ─── AI Input Bar ───────────────────────────────────────────────
  function toggleAIBar() {
    state.isAIBarOpen = !state.isAIBarOpen;
    dom.aiInputBar.classList.toggle('hidden', !state.isAIBarOpen);
    dom.btnAsk.classList.toggle('active', state.isAIBarOpen);
    if (state.isAIBarOpen) {
      dom.aiInput.focus();
    }
  }

  // ─── Audio Visualizer ───────────────────────────────────────────
  function createAudioVisualizer() {
    const container = document.createElement('div');
    container.id = 'audio-visualizer';
    container.style.display = 'none';
    const statusBar = $('#status-bar');
    statusBar.parentNode.insertBefore(container, statusBar.nextSibling);

    for (let i = 0; i < 32; i++) {
      const bar = document.createElement('div');
      bar.className = 'viz-bar';
      bar.style.height = '2px';
      container.appendChild(bar);
    }
  }

  function startVisualizer(stream) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 64;
    source.connect(state.analyserNode);

    const container = $('#audio-visualizer');
    container.style.display = 'flex';
    const bars = container.querySelectorAll('.viz-bar');
    const dataArray = new Uint8Array(state.analyserNode.frequencyBinCount);

    function animate() {
      state.analyserNode.getByteFrequencyData(dataArray);
      bars.forEach((bar, i) => {
        const value = dataArray[i] || 0;
        const height = Math.max(2, (value / 255) * 18);
        bar.style.height = `${height}px`;
        bar.style.opacity = 0.4 + (value / 255) * 0.6;
      });
      state.animationFrameId = requestAnimationFrame(animate);
    }
    animate();
  }

  function stopVisualizer() {
    if (state.animationFrameId) {
      cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
    }
    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
    }
    const container = $('#audio-visualizer');
    if (container) {
      container.style.display = 'none';
      container.querySelectorAll('.viz-bar').forEach(b => b.style.height = '2px');
    }
  }

  // ─── Audio Capture ──────────────────────────────────────────────
  async function startListening() {
    try {
      setStatus('listening', 'Requesting audio streams...');

      // 1. Microphone (Optional)
      let micStream = null;
      if (state.settings.captureMic !== false) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
          });
        } catch (micErr) {
          console.warn('Microphone access failed or denied:', micErr);
          showToast('Microphone not accessible. capturing system audio only.', 'warning');
        }
      }

      // 2. Desktop Audio
      let desktopStream = null;
      try {
        const sources = await window.electronAPI.getDesktopSources();
        if (sources && sources.length > 0) {
          desktopStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sources[0].id,
              },
            },
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sources[0].id,
              },
            },
          });
          desktopStream.getVideoTracks().forEach(t => t.stop());
        }
      } catch (desktopErr) {
        console.warn('Desktop audio not available:', desktopErr.message);
      }

      // 3. Combine Streams
      if (!micStream && !desktopStream) {
        throw new Error('No audio sources available (Mic and Desktop both failed or disabled)');
      }

      if (micStream && desktopStream) {
        // We have both, mix them — store the context so we can close it on stop
        state.mixerAudioContext = new AudioContext();
        const dest = state.mixerAudioContext.createMediaStreamDestination();
        state.mixerAudioContext.createMediaStreamSource(micStream).connect(dest);
        state.mixerAudioContext.createMediaStreamSource(new MediaStream(desktopStream.getAudioTracks())).connect(dest);
        state.mediaStream = dest.stream;
      } else {
        // We only have one of them
        state.mediaStream = micStream || desktopStream;
      }

      startVisualizer(state.mediaStream);
      clearEmptyState(dom.transcriptContent);

      state.isListening = true;
      dom.btnStart.classList.add('hidden');
      dom.btnStop.classList.remove('hidden');
      setStatus('listening', 'Listening...');
      startSessionTimer();

      if (state.envKeys.DEEPGRAM_API_KEY) {
        connectDeepgram();
      } else {
        setStatus('listening', 'Listening (demo mode)');
        showToast('Demo mode — no Deepgram key', 'warning');
        startDemoTranscript();
      }
    } catch (err) {
      console.error('Failed to start listening:', err);
      setStatus('error', 'Microphone access denied');
      showToast('Microphone access denied. Please grant permission.', 'error');
    }
  }

  function stopListening() {
    if (!state.isListening) return;
    state.isListening = false;

    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach(t => t.stop());
      state.mediaStream = null;
    }
    // Close the mixer AudioContext to prevent memory leak
    if (state.mixerAudioContext) {
      state.mixerAudioContext.close();
      state.mixerAudioContext = null;
    }
    // Clear Deepgram keep-alive
    if (state.deepgramKeepAliveInterval) {
      clearInterval(state.deepgramKeepAliveInterval);
      state.deepgramKeepAliveInterval = null;
    }
    if (state.deepgramSocket) {
      state.deepgramSocket.onclose = null;
      state.deepgramSocket.onerror = null;
      state.deepgramSocket.close();
      state.deepgramSocket = null;
      dom.deepgramStatus.textContent = '🎙️ ─';
      dom.deepgramStatus.classList.remove('connected');
      dom.deepgramStatus.classList.remove('error');
    }
    if (state.mediaRecorder) {
      state.mediaRecorder.stop();
      state.mediaRecorder = null;
    }
    stopVisualizer();
    if (state.demoInterval) {
      clearInterval(state.demoInterval);
      state.demoInterval = null;
    }
    // Clear pending question state
    state.pendingQuestion = null;
    if (state.questionDebounce) {
      clearTimeout(state.questionDebounce);
      state.questionDebounce = null;
    }

    dom.btnStop.classList.add('hidden');
    dom.btnStart.classList.remove('hidden');
    setStatus('idle', 'Stopped — Press Start to resume');
    stopSessionTimer();
    showToast('Listening stopped', 'info');
  }

  // ─── Demo Transcript ───────────────────────────────────────────
  function startDemoTranscript() {
    const demoLines = [
      { speaker: 'Interviewer', text: 'Thanks for joining us today. Can you tell me a bit about your background?' },
      { speaker: 'You', text: 'Of course! I have been working in software development for 5 years...' },
      { speaker: 'Interviewer', text: 'That sounds great. Can you walk me through a challenging project you worked on?' },
      { speaker: 'You', text: 'Sure, recently I built a real-time data pipeline that processes millions of events per day.' },
      { speaker: 'Interviewer', text: 'Interesting! What technologies did you use for that?' },
      { speaker: 'You', text: 'We used Kafka for message queuing, Flink for stream processing, and PostgreSQL for persistence.' },
      { speaker: 'Interviewer', text: 'How did you handle failure scenarios and data consistency?' },
      { speaker: 'You', text: 'We implemented idempotent consumers and used exactly-once semantics with Kafka transactions.' },
    ];

    let idx = 0;
    state.demoInterval = setInterval(() => {
      if (idx >= demoLines.length) {
        clearInterval(state.demoInterval);
        state.demoInterval = null;
        if (state.envKeys.GEMINI_API_KEY) {
          autoGenerateHint('How did you handle failure scenarios and data consistency?');
        } else {
          addAIResponse('🔍 Auto-detected question', generateDemoAIResponse());
        }
        return;
      }
      addTranscriptItem(demoLines[idx].speaker, demoLines[idx].text);
      idx++;
    }, 2500);
  }

  function generateDemoAIResponse() {
    return `Here's a suggested answer based on your background:

💡 **Suggested Response:**
"We implemented several strategies for reliability:

1. **Idempotent Consumers** — Each message has a unique ID, and we deduplicate on the consumer side
2. **Exactly-Once Semantics** — Kafka transactions ensure no duplicates in processing
3. **Dead Letter Queues** — Failed messages are routed to DLQs for manual inspection
4. **Circuit Breakers** — Prevent cascade failures when downstream services are unavailable
5. **Monitoring** — Real-time dashboards with PagerDuty alerts for anomalies"

📋 **STAR Method:**
- **Situation:** High-throughput data pipeline
- **Task:** Ensure zero data loss
- **Action:** Implemented idempotency + transactions
- **Result:** 99.99% reliability, zero data loss in 18 months`;
  }

  // ─── Deepgram Transcription ─────────────────────────────────────
  function connectDeepgram() {
    const apiKey = state.envKeys.DEEPGRAM_API_KEY;
    if (!apiKey) return;

    setStatus('listening', 'Connecting to Deepgram...');
    dom.deepgramStatus.textContent = '🎙️ …';

    const url = `wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=true&smart_format=true&diarize=true&language=en`;
    const socket = new WebSocket(url, ['token', apiKey]);
    state.deepgramSocket = socket;

    socket.onopen = () => {
      dom.deepgramStatus.textContent = '🎙️ ✓';
      dom.deepgramStatus.classList.add('connected');
      setStatus('listening', 'Live transcription active');
      showToast('Deepgram connected', 'success');
      startAudioStream(socket);

      // Send keep-alive every 10s to prevent Deepgram from dropping the socket after 30s of silence
      state.deepgramKeepAliveInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 10000);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.channel?.alternatives?.length > 0) {
        const alt = data.channel.alternatives[0];
        const text = alt.transcript;
        if (!text) return;

        const isFinal = data.is_final;

        let speaker = 'Speaker';
        if (alt.words?.length > 0) {
          const s = alt.words[0].speaker || 0;
          // Heuristic: App user is usually on a headset, so they could map to 0, or interviewer could. 
          // We will assign "Interviewer" to the first person who speaks a question. 
          // But a safe generic approach is numbering unless it's clearly you vs them.
          speaker = s === 0 ? 'Speaker A' : s === 1 ? 'Speaker B' : `Speaker ${s}`;
        }

        if (isFinal) {
          addTranscriptItem(speaker, text);
          // NOTE: transcriptForAI is already appended inside addTranscriptItem(), no duplicate here

          // ═══════════════════════════════════════════════════════════
          // SMART QUESTION ACCUMULATION — Handles interviewer pauses
          // ═══════════════════════════════════════════════════════════
          // Problem: Interviewer says "Can you explain... [2s pause]... the difference between X and Y?"
          // Old behavior: fires AI after 1.2s on "Can you explain" = half question
          // New behavior: accumulate ALL text once question mode starts, use completeness heuristic

          const wordCount = text.trim().split(/\s+/).length;
          const isQuestionTrigger = wordCount >= 4 && (text.includes('?') ||
            /\b(tell me|describe|explain|how (do|would|did|could)|what (is|are|was|were|would)|why (do|did|would)|walk me|give me an example|have you ever|can you|could you|write|implement|build|design|create|solve|find|calculate|optimize)\b/i.test(text));

          const hasAnyKey = state.envKeys.GEMINI_API_KEY || state.envKeys.VERTEX_API_KEY || state.envKeys.GROQ_API_KEY ||
            state.envKeys.OPENROUTER_API_KEY || state.envKeys.TOGETHER_API_KEY ||
            state.envKeys.MISTRAL_API_KEY || state.envKeys.COHERE_API_KEY;

          if (state.pendingQuestion) {
            // ALREADY in accumulation mode — append EVERYTHING (don't replace)
            const combined = state.pendingQuestion + ' ' + text;
            state.pendingQuestion = combined.length > 800 ? combined.slice(0, 800) : combined;
            state.lastQuestionType = classifyQuestion(state.pendingQuestion);
          } else if (isQuestionTrigger && state.settings.autoDetect && hasAnyKey) {
            // NEW question detected — start accumulation mode
            state.pendingQuestion = text;
            state.lastQuestionType = classifyQuestion(text);
          }
        } else {
          updatePartialTranscript(text);
        }

        // ─── Smart Debounce with Completeness Heuristic ───
        // Short pause (2.5s) → check if question is complete → fire or extend to 4.5s
        if (state.pendingQuestion && state.settings.autoDetect) {
          clearTimeout(state.questionDebounce);

          const shortDelay = 1500;  // first check after 1.5s of silence
          const longDelay = 3000;   // max wait if question looks incomplete

          state.questionDebounce = setTimeout(() => {
            const q = state.pendingQuestion;
            if (!q) return;

            if (looksComplete(q)) {
              // Question looks finished — fire AI now
              autoGenerateHint(q);
              state.pendingQuestion = null;
            } else {
              // Question looks incomplete (mid-sentence) — wait a bit more
              state.questionDebounce = setTimeout(() => {
                if (state.pendingQuestion) {
                  autoGenerateHint(state.pendingQuestion);
                  state.pendingQuestion = null;
                }
              }, longDelay - shortDelay);
            }
          }, shortDelay);
        }
      }
    };

    socket.onerror = () => {
      dom.deepgramStatus.textContent = '🎙️ ✗';
      dom.deepgramStatus.classList.remove('connected');
      dom.deepgramStatus.classList.add('error');
      showToast('Deepgram connection error', 'error');
      if (state.isListening) stopListening();
    };

    socket.onclose = () => {
      dom.deepgramStatus.textContent = '🎙️ ─';
      dom.deepgramStatus.classList.remove('connected');
      if (state.isListening) {
        stopListening();
        showToast('Deepgram disconnected unexpectedly', 'warning');
      }
    };
  }

  function startAudioStream(socket) {
    if (!state.mediaStream) return;

    // Check MIME type support and fallback gracefully
    const preferredMime = 'audio/webm;codecs=opus';
    const fallbackMime = 'audio/webm';
    const mimeType = MediaRecorder.isTypeSupported(preferredMime) ? preferredMime
      : MediaRecorder.isTypeSupported(fallbackMime) ? fallbackMime
      : undefined; // let browser pick default

    const recorderOptions = mimeType ? { mimeType } : {};
    const mediaRecorder = new MediaRecorder(state.mediaStream, recorderOptions);
    state.mediaRecorder = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(event.data);
      }
    };

    mediaRecorder.start(250);
  }

  // ─── Transcript UI ──────────────────────────────────────────────
  function clearEmptyState(container) {
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();
  }

  function addTranscriptItem(speaker, text) {
    clearEmptyState(dom.transcriptContent);
    removePartialTranscript();

    const item = document.createElement('div');
    item.className = 'transcript-item';

    const time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    item.innerHTML = `
      <div class="transcript-meta">
        <span class="transcript-speaker">${escapeHTML(speaker)}</span>
        <span class="transcript-time">${time}</span>
      </div>
      <div class="transcript-text">${escapeHTML(text)}</div>
      <button class="item-copy-btn" title="Copy">📋</button>
    `;
    item.querySelector('.item-copy-btn').addEventListener('click', () => copyItemText(item, text));

    dom.transcriptContent.appendChild(item);
    if (state.settings.autoScroll) {
      dom.transcriptContent.scrollTop = dom.transcriptContent.scrollHeight;
    }

    state.transcript.push({ speaker, text, time });
    state.transcriptForAI += `${speaker}: ${text}\n`;
  }

  function updatePartialTranscript(text) {
    let partial = dom.transcriptContent.querySelector('.partial-item');
    if (!partial) {
      partial = document.createElement('div');
      partial.className = 'transcript-item partial-item';
      partial.innerHTML = `<div class="transcript-text partial"></div>`;
      dom.transcriptContent.appendChild(partial);
    }
    partial.querySelector('.transcript-text').textContent = text;
    if (state.settings.autoScroll) {
      dom.transcriptContent.scrollTop = dom.transcriptContent.scrollHeight;
    }
  }

  function removePartialTranscript() {
    const partial = dom.transcriptContent.querySelector('.partial-item');
    if (partial) partial.remove();
  }

  // ─── Screen Capture & Analysis ──────────────────────────────────
  async function captureAndAnalyzeScreen() {
    try {
      showToast('Capturing screen...', 'info');
      dom.btnScreen.classList.add('active');

      const sources = await window.electronAPI.getDesktopSources();
      if (!sources || sources.length === 0) {
        showToast('No screen sources available', 'error');
        dom.btnScreen.classList.remove('active');
        return;
      }

      // Pick the primary screen source, but skip our own window to avoid self-capture
      const screenSource = sources.find(s => s.name === 'Entire Screen' || s.name === 'Screen 1' || s.id.startsWith('screen:'))
        || sources.find(s => !s.name.includes('Security Health') && !s.name.includes('EliteCODE'))
        || sources[0];

      // Capture via desktopCapturer
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screenSource.id,
          },
        },
      });

      // Grab a frame with proper cleanup
      const video = document.createElement('video');
      video.srcObject = stream;
      try {
        await video.play();
      } catch (playErr) {
        stream.getTracks().forEach(t => t.stop());
        video.srcObject = null;
        showToast('Could not capture screen frame', 'error');
        dom.btnScreen.classList.remove('active');
        return;
      }

      // Resize to max 1024px to keep under API limits
      const maxWidth = 1024;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Stop the stream and release the video element
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;

      const dataUrl = canvas.toDataURL('image/jpeg', 0.5);

      // Switch to screen tab
      switchTab('screen-analysis');
      clearEmptyState(dom.screenContent);

      // Create screen analysis item
      const item = document.createElement('div');
      item.className = 'screen-item';
      const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <div class="screen-item-header">
          <span class="screen-item-label">🖥️ Screen Capture</span>
          <span class="screen-item-time">${time}</span>
        </div>
        <img class="screen-item-preview" src="${dataUrl}" alt="Screen capture" />
        <div class="screen-item-analysis">
          <span class="thinking">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
          </span> Analyzing screen content...
        </div>
      `;
      dom.screenContent.appendChild(item);
      dom.screenContent.scrollTop = dom.screenContent.scrollHeight;

      const analysisEl = item.querySelector('.screen-item-analysis');

      // Analyze with Vision model or demo
      const hasAnyKey = state.envKeys.GEMINI_API_KEY || state.envKeys.VERTEX_API_KEY || state.envKeys.GROQ_API_KEY ||
        state.envKeys.OPENROUTER_API_KEY || state.envKeys.TOGETHER_API_KEY ||
        state.envKeys.MISTRAL_API_KEY || state.envKeys.COHERE_API_KEY;

      if (hasAnyKey) {
        await analyzeScreenWithAI(dataUrl, analysisEl);
      } else {
        setTimeout(() => {
          analysisEl.textContent = `📊 Screen Analysis (Demo Mode)

🖥️ Detected Content:
• Video call interface (possibly Zoom/Teams/Meet)
• Chat window with participant names visible
• Shared presentation or document

💡 Suggested Actions:
• The interviewer appears to be showing a system design diagram
• Consider discussing load balancing and horizontal scaling
• Mention your experience with similar architectures

⚠️ Note: Add any API key in .env for real AI-powered screen analysis.`;
        }, 2000);
      }

      dom.btnScreen.classList.remove('active');
    } catch (err) {
      console.error('Screen capture error:', err);
      showToast('Screen capture failed: ' + err.message, 'error');
      dom.btnScreen.classList.remove('active');
    }
  }

  async function analyzeScreenWithAI(imageDataUrl, outputEl) {
    try {
      const systemPrompt = `You are a friendly senior developer helping a FRESHER candidate in a live interview. The candidate is a beginner — your answer must be easy for them to understand and explain confidently.

CRITICAL RULES — Detect WHAT is on screen and respond accordingly:

1. **CODING PROBLEM** (LeetCode, HackerRank, CodeSignal, or any coding challenge):
   - FIRST write "**🧠 Thinking out loud:**" followed by a natural, conversational thought process — as if the candidate is working through the problem live. Write in first person like:
     "Okay so first I'm going to take the input array. The problem is asking me to find two numbers that add up to the target. So what if I use a hashmap? For each number, I'll check if the complement exists in the map. If yes, I found my answer. If not, I'll store the current number. That way I only need one pass."
     This should sound like natural thinking, NOT a formal explanation. Use phrases like "okay so", "what if I", "let me think", "so basically", "that means I need to".
   - THEN provide the COMPLETE SOLUTION in a clean code block
   - CODE FORMATTING RULES:
     • Use clear, descriptive variable names (not i, j, k — use left, right, currentSum, etc.)
     • Add a blank line between logical sections of code
     • Add short inline comments on tricky lines
     • Use consistent indentation (2 spaces)
     • Keep each line short and readable
   - After the code, write "**Complexity:** Time: O(...) | Space: O(...)"
   - Finally write "**💬 What to say after coding:**" with 1-2 sentences to wrap up.

2. **CONCEPTUAL / THEORY QUESTION** (e.g. "What is polymorphism?", "Explain REST vs GraphQL", asked in a chatbox, AI interviewer, or platform):
   - Start with "**💡 Answer:**" followed by a clear, concise direct answer (2-3 sentences max).
   - Add "**📌 Key Points:**" with 2-3 bullet points for depth.
   - End with "**💬 Say this:**" — a natural, spoken-style sentence the candidate can say out loud.
   - Keep total under 120 words. Sound conversational, not textbook.

3. **CHATBOX / AI INTERVIEWER QUESTION** (question typed in chat, Zoom chat, Teams, Slack, or an AI interview platform):
   - Treat the QUESTION TEXT in the chatbox as the interview question — answer it directly.
   - Follow the same format as conceptual questions above unless it's a coding problem.
   - If the chatbox contains a coding task, use the coding format from rule 1.

4. **BEHAVIORAL QUESTION** (e.g. "Tell me about a time when...", "Describe a challenge you faced"):
   - Use STAR format:
     **Situation:** (1-2 sentences)
     **Task:** (1 sentence)
     **Action:** (2-3 sentences — the longest section)
     **Result:** (1 sentence with a measurable outcome if possible)
   - Write in first person. Sound natural.

5. **SYSTEM DESIGN** diagram or question:
   - Explain in simple terms what each component does
   - Suggest improvements the candidate can mention confidently
   - Format as bullet points with emoji labels

6. **DOCUMENT or PRESENTATION**:
   - Pull out key talking points as bullet points
   - Highlight anything the candidate should be prepared to discuss

NEVER just describe what you see. Always SOLVE or ANSWER it. Write like you're coaching a nervous fresher through their first interview.`;

      const userPrompt = state.settings.resume
        ? `Analyze this screen and help me solve it. I'm a fresher. My background: ${state.settings.resume.slice(0, 300)}`
        : `Analyze this screen capture and solve whatever coding problem or question is shown. I'm a fresher, so explain simply.`;

      outputEl.innerHTML = '';
      const responseText = await callLLM(systemPrompt, userPrompt, 2000, imageDataUrl, (currentText) => {
        typeText(outputEl, currentText, 0, true);
      });
      state.lastScreenAnalysisText = responseText;

      // Cache for mini-mode / teleprompter / follow-up
      state.latestAIAnswer = responseText;
      state.conversationHistory.push({ question: '[Screen Capture Analysis]', answer: responseText });
      if (state.conversationHistory.length > 5) state.conversationHistory.shift();

      if (state.windowMode === 'MINI' && dom.miniAnswerContent) {
        dom.miniAnswerContent.innerHTML = parseMarkdown(responseText);
      }
      if (state.windowMode === 'TELEPROMPTER') {
        startTeleprompterScroll(responseText);
      }
    } catch (err) {
      outputEl.innerHTML = `<span style="color: var(--danger)">Error: ${escapeHTML(err.message)}<br><small>Note: You may be using a model that does not natively support Vision/Image requests. Please pick a Vision model from OpenRouter or Gemini.</small></span>`;
    }
  }

  // ─── AI Integration ───────────────────────────────────────────
  const BEHAVIORAL_PATTERNS = /\b(tell me about a time|give me an example|describe a situation|walk me through|have you ever|share an experience|a challenge you faced|how did you handle|a time when you)\b/i;

  function isBehavioralQuestion(text) {
    return BEHAVIORAL_PATTERNS.test(text);
  }

  // ─── Question Type Classifier ──────────────────────────────────
  function classifyQuestion(text) {
    const lower = text.toLowerCase();

    // BEHAVIORAL: STAR format
    if (isBehavioralQuestion(text)) return 'BEHAVIORAL';

    // CODE: write/solve/implement code, algorithms
    if (/\b(write (a |the )?(code|function|program|algorithm|solution)|solve (this|the)|implement|code (for|to|this)|write (me )?a|leetcode|hackerrank|reverse|sort|search|binary|linked list|array|string|tree|graph|dp|dynamic programming|recursion|two pointer|sliding window)\b/i.test(lower)) {
      return 'CODE';
    }

    // DESIGN: system design, architecture
    if (/\b(design (a |the )?(system|architecture|database|api|microservice|service)|system design|scale|scalab|load balanc|caching|distributed|high availability|low latency)\b/i.test(lower)) {
      return 'DESIGN';
    }

    // IMPLEMENTATION: build/create a feature, practical
    if (/\b(build (a |the )?|create (a |the )?|make (a |the )?|develop|how would you (build|create|make|implement)|todo|crud|login|signup|dashboard|form|api endpoint)\b/i.test(lower)) {
      return 'IMPLEMENTATION';
    }

    // SHORT: everything else (definitions, concepts, comparisons)
    return 'SHORT';
  }

  function buildSystemPrompt(includeTranscript = true, question = '') {
    let prompt = "";

    // STAR mode for behavioral questions
    if (question && isBehavioralQuestion(question)) {
      prompt = `You are a real-time interview assistant. The user has been asked a BEHAVIORAL question. Format your answer using the STAR method:

**Situation:** [Set the scene in 1-2 sentences]
**Task:** [What was your responsibility]
**Action:** [What you specifically did — this should be the longest section]
**Result:** [Quantifiable outcome if possible]

CRITICAL RULES:
1. Write in first person as if the candidate is speaking.
2. Sound natural and conversational, not robotic.
3. Keep total response under 150 words.
4. Start IMMEDIATELY with the Situation — no preamble.`;

      if (state.settings.resume) {
        prompt += `\n\nBase your story on this background:\n${state.settings.resume}`;
      }
    } else if (state.settings.detailedMode) {
      prompt = `You are a world-class Senior Software Engineer acting as a mentor in an interview. Your job is to provide incredibly comprehensive, deeply detailed, and perfectly formatted answers.
CRITICAL RULES FOR DETAILED MODE:
1. Break down the answer into structured, logical sections using markdown headings.
2. Provide code examples, real-world analogies, and explain the "Why" behind the "What".
3. Use bolding to highlight key technical terms.
4. Go far beyond a surface-level answer—be exhaustive and demonstrate deep mastery.`;
    } else {
      // Detect question type for smart formatting
      const qType = state.lastQuestionType || classifyQuestion(question);

      prompt = `You are a real-time smart assistant for software engineering interviews. The candidate is a FRESHER — your answers must be simple, clear, and easy to speak out loud.
CRITICAL RULES:
1. YOUR FIRST LINE MUST BE THE DIRECT ANSWER in bold. No preamble, no "Certainly", no "Great question". Just the answer.
2. AFTER the direct answer, give a short real-world example or analogy if it helps understanding.
3. Write in a conversational, spoken tone — like a fresher naturally explaining to an interviewer.
4. Use simple words. Avoid jargon unless the question specifically uses it.
5. Keep the entire response concise (under 120 words for short questions). The candidate needs to read it in 2-3 seconds.`;

      // Dynamic formatting based on auto-detected question type
      if (qType === 'CODE' || state.settings.strictCode) {
        prompt += `\n\n💻 CODING QUESTION FORMAT:
  1. "**🧠 Let me think through this:**" — Natural thought process (2-3 sentences). Sound like you're working through it: "Okay so I need to... what if I use..."
  2. COMPLETE SOLUTION in a clean code block. Descriptive variable names. Blank lines between sections. Short inline comments.
  3. "**Complexity:** Time: O(...) | Space: O(...)" 
  4. "**💬 Say this:**" — 1 sentence wrap-up.`;
      } else if (qType === 'DESIGN') {
        prompt += `\n\n🏗️ SYSTEM DESIGN FORMAT:
  1. Direct answer: what you would build (1 sentence bold)
  2. Key components as bullet points (Database, API, Cache, etc.)
  3. Trade-offs and scaling notes
  4. "**💬 Say this:**" — 1 sentence summary`;
      } else if (qType === 'IMPLEMENTATION') {
        prompt += `\n\n🛠️ IMPLEMENTATION FORMAT:
  1. Direct answer: the approach (1 sentence bold)
  2. Step-by-step with small code snippets
  3. "**💬 Say this:**" — Explain approach simply`;
      } else {
        // SHORT / default — answer first, then example
        prompt += `\n\nFORMAT: **Direct answer** (1-2 sentences bold) → Then a brief example or analogy if helpful → Keep total under 100 words.`;
        if (state.settings.strictCompare) {
          prompt += `\n- FOR COMPARISONS: 2-3 bullet points. Key difference first in each.`;
        }
        if (state.settings.strictExplain) {
          prompt += `\n- FOR EXPLANATIONS: 2-3 bullet points using simple analogies.`;
        }
      }
    }

    if (state.settings.useScreenContext && state.lastScreenAnalysisText) {
      prompt += `\n\n🖼️ PREVIOUS SCREEN CAPTURE ANALYSIS:\n${state.lastScreenAnalysisText}\n\nIMPORTANT: If the user's question relates to a coding problem, diagram, or context visible on their screen, use this analysis to answer accurately.`;
    }

    if (state.settings.resume) {
      prompt += `\n\n💼 CANDIDATE'S BACKGROUND:\n${state.settings.resume}\n\nALWAYS weave in relevant skills or experience from this background naturally into your answers. If the interviewer asks something out of the box or unexpected, still reference this background to make the answer sound authentic and personal.`;
    }
    if (state.settings.jobDescription) {
      prompt += `\n\n🎯 TARGET JOB DESCRIPTION:\n${state.settings.jobDescription}\n\nIMPORTANT: Align answers with the key requirements mentioned in this job description.`;
    }
    if (state.settings.customInstructions) {
      prompt += `\n\n⚙️ CUSTOM INSTRUCTIONS:\n${state.settings.customInstructions}`;
    }

    // Follow-up context memory (last 5 Q&A pairs)
    if (state.conversationHistory.length > 0) {
      const historyText = state.conversationHistory
        .map(h => `Q: ${h.question}\nA: ${h.answer.slice(0, 200)}...`)
        .join('\n\n');
      prompt += `\n\n💬 PREVIOUS Q&A IN THIS SESSION (for follow-up context):\n${historyText}\n\nIMPORTANT: If the current question is a follow-up (e.g. "Can you optimize that?", "What about edge cases?"), use the above context to give a coherent continuation.`;
    }

    if (includeTranscript) {
      const contextText = state.transcriptForAI || state.transcript.map(t => `${t.speaker}: ${t.text}`).join('\n');
      if (contextText) {
        prompt += `\n\n🎙️ LIVE INTERVIEW TRANSCRIPT:\n${contextText}`;
      }
    }

    return prompt;
  }

  async function sendAIQuestion() {
    const question = dom.aiInput.value.trim();
    if (!question) return;
    dom.aiInput.value = '';

    if (question.toLowerCase().includes('summar')) {
      switchTab('summary');
      await generateSummary();
      return;
    }

    switchTab('ai-hints');
    await askAI(question);
  }

  async function autoGenerateHint(detectedQuestion) {
    if (state.settings.autoSwitch && state.activeTab === 'transcript') {
      switchTab('ai-hints');
    }
    await askAI(detectedQuestion, true);
  }

  async function askAI(question, isAutoDetected = false) {
    clearEmptyState(dom.aiContent);

    // Show badge if not on AI tab
    if (state.activeTab !== 'ai-hints' && dom.badgeAI) {
      dom.badgeAI.classList.remove('hidden');
    }

    const itemEl = createAIResponseElement(
      isAutoDetected ? '🔍 Auto-detected' : '💬 Your question',
      question
    );
    dom.aiContent.appendChild(itemEl);
    dom.aiContent.scrollTop = dom.aiContent.scrollHeight;

    const answerEl = itemEl.querySelector('.ai-item-answer');

    const hasAnyKey = state.envKeys.GEMINI_API_KEY || state.envKeys.VERTEX_API_KEY || state.envKeys.GROQ_API_KEY ||
      state.envKeys.OPENROUTER_API_KEY || state.envKeys.TOGETHER_API_KEY ||
      state.envKeys.MISTRAL_API_KEY || state.envKeys.COHERE_API_KEY;

    if (!hasAnyKey) {
      answerEl.innerHTML = '';
      const demoAnswer = isAutoDetected
        ? generateDemoAIResponse()
        : `I'd help with that! Based on the meeting context:\n\n"${question}"\n\nAdd any API key (Groq, Gemini, OpenRouter, etc.) in .env to get real AI-powered answers tailored to your resume and job description.`;
      typeText(answerEl, demoAnswer, 0, true);
      if (!isAutoDetected) switchTab('ai-hints');
      return;
    }

    try {
      const systemPrompt = buildSystemPrompt(true, question);
      answerEl.innerHTML = '';
      const responseText = await callLLM(systemPrompt, question, 800, null, (currentText) => {
        typeText(answerEl, currentText, 0, true);
      });

      dom.openaiStatus.textContent = '🤖 ✓';
      dom.openaiStatus.classList.add('connected');

      state.aiResponses.push({ question, answer: responseText });

      // ─── Follow-up memory: store last 5 Q&A pairs ───
      state.conversationHistory.push({ question, answer: responseText });
      if (state.conversationHistory.length > 5) {
        state.conversationHistory.shift();
      }

      // ─── Cache for mini-mode and teleprompter ───
      state.latestAIAnswer = responseText;
      if (state.windowMode === 'MINI' && dom.miniAnswerContent) {
        dom.miniAnswerContent.innerHTML = parseMarkdown(responseText);
      }
      if (state.windowMode === 'TELEPROMPTER') {
        startTeleprompterScroll(responseText);
      }
    } catch (err) {
      answerEl.innerHTML = `<span style="color: var(--danger)">Error: ${escapeHTML(err.message)}</span>`;
      dom.openaiStatus.textContent = '🤖 ✗';
      dom.openaiStatus.classList.remove('connected');
      dom.openaiStatus.classList.add('error');
    }
  }

  // ─── Universal LLM Router ────────────────────────────────────────────────
  async function callLLM(systemPrompt, userPrompt, maxTokens = 1200, imageDataUrl = null, onChunk = null) {
    const model = state.settings.model;
    let endpoint = '';
    let apiKey = '';
    let payload = {};
    let headers = { 'Content-Type': 'application/json' };
    let parseResponse = null;

    // 1. Google Gemini (REST API format is unique)
    if (model.includes('gemini')) {
      apiKey = state.envKeys.GEMINI_API_KEY || state.envKeys.VERTEX_API_KEY;
      if (!apiKey) throw new Error("Missing GEMINI_API_KEY or VERTEX_API_KEY");

      const method = onChunk ? 'streamGenerateContent?alt=sse&key=' : 'generateContent?key=';
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${apiKey}`;

      const contents = [];
      let textPart = userPrompt || '';
      if (systemPrompt) textPart = `${systemPrompt}\n\nQuestion/Prompt/Transcript:\n${textPart}`;

      const parts = [{ text: textPart }];

      if (imageDataUrl) {
        const base64Data = imageDataUrl.split(',')[1];
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data } });
      }

      contents.push({ role: 'user', parts: parts });

      payload = {
        contents: contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      };
      parseResponse = (data) => data.candidates?.[0]?.content?.parts?.[0]?.text;
    }
    // 2. OpenAI-Compatible Providers (Groq, Together, Mistral, OpenRouter, Cohere)
    else {
      payload = {
        model: model,
        max_tokens: maxTokens,
        temperature: 0.4,
        messages: []
      };
      // Enable streaming — Cohere v2 uses `stream: true` the same way
      if (onChunk) payload.stream = true;

      if (systemPrompt) payload.messages.push({ role: 'system', content: systemPrompt });

      if (imageDataUrl) {
        payload.messages.push({
          role: 'user',
          content: [
            { type: "text", text: userPrompt || "Analyze this image" },
            { type: "image_url", image_url: { url: imageDataUrl } }
          ]
        });
      } else {
        // OpenRouter free models sometimes act like completion models instead of chat models
        // if the system prompt is completely separate. We'll ensure it's explicitly instruction-formatted.
        if (model.includes('openrouter') && model.includes('free') && systemPrompt) {
          payload.messages = [{ role: 'user', content: `${systemPrompt}\n\nUser Question:\n${userPrompt}` }];
        } else {
          payload.messages.push({ role: 'user', content: userPrompt });
        }
      }

      if (model.includes('llama') && !model.includes('meta-llama/')) {
        // Groq
        apiKey = state.envKeys.GROQ_API_KEY;
        if (!apiKey) throw new Error("Missing GROQ_API_KEY");
        endpoint = 'https://api.groq.com/openai/v1/chat/completions';
      }
      else if (model.includes('openrouter') || model.includes('gemma')) {
        // OpenRouter
        apiKey = state.envKeys.OPENROUTER_API_KEY;
        if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        headers['HTTP-Referer'] = 'http://localhost:3000';
        headers['X-Title'] = 'SecurityHealthService';
      }
      else if (model.includes('mistral')) {
        // Mistral
        apiKey = state.envKeys.MISTRAL_API_KEY;
        if (!apiKey) throw new Error("Missing MISTRAL_API_KEY");
        endpoint = 'https://api.mistral.ai/v1/chat/completions';
      }
      else if (model.includes('command')) {
        // Cohere v2
        apiKey = state.envKeys.COHERE_API_KEY;
        if (!apiKey) throw new Error("Missing COHERE_API_KEY");
        endpoint = 'https://api.cohere.com/v2/chat';
        parseResponse = (data) => data.message?.content?.[0]?.text; // Cohere v2 specific response structure
      }
      else if (model.includes('Meta-Llama') || model.includes('Qwen')) {
        // Together AI
        apiKey = state.envKeys.TOGETHER_API_KEY;
        if (!apiKey) throw new Error("Missing TOGETHER_API_KEY");
        endpoint = 'https://api.together.xyz/v1/chat/completions';
      }

      headers['Authorization'] = `Bearer ${apiKey}`;
      if (!parseResponse) {
        parseResponse = (data) => data.choices?.[0]?.message?.content;
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`API Error (${response.status}): ${errData?.error?.message || errData?.message || 'Unknown'}`);
    }

    if (onChunk) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.trim() === 'data: [DONE]') continue;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              let chunkText = "";
              if (model.includes('gemini')) {
                chunkText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
              } else if (model.includes('command')) {
                // Cohere v2 stream format specifically embeds text chunks differently
                if (data.type === "content-delta") chunkText = data.delta?.message?.content?.text || "";
              } else {
                chunkText = data.choices?.[0]?.delta?.content || "";
              }

              if (chunkText) {
                fullText += chunkText;
                onChunk(fullText); // pass full accumulated text so markdown parses correctly
              }
            } catch (e) {
              // Ignore parse errors for partial chunks
            }
          }
        }
      }
      return fullText;
    }

    const data = await response.json();
    const resultText = parseResponse(data);
    if (!resultText) throw new Error("Empty response returned from AI provider.");
    return resultText;
  }

  async function generateSummary() {
    clearEmptyState(dom.summaryContent);

    const section = document.createElement('div');
    section.className = 'summary-section';
    section.innerHTML = `
      <div class="summary-title">📋 Meeting Summary</div>
      <div class="summary-content"><span class="thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span> Generating summary...</div>
    `;
    dom.summaryContent.appendChild(section);

    const contentEl = section.querySelector('.summary-content');

    const hasAnyKey = state.envKeys.GEMINI_API_KEY || state.envKeys.VERTEX_API_KEY || state.envKeys.GROQ_API_KEY ||
      state.envKeys.OPENROUTER_API_KEY || state.envKeys.TOGETHER_API_KEY ||
      state.envKeys.MISTRAL_API_KEY || state.envKeys.COHERE_API_KEY;

    if (!hasAnyKey) {
      setTimeout(() => {
        const speakers = [...new Set(state.transcript.map(t => t.speaker))].join(', ') || 'N/A';
        contentEl.textContent = `📝 Meeting Summary (Demo Mode)

🕐 Duration: ~${Math.round(state.transcript.length * 2.5)} seconds
👥 Participants: ${speakers}

📋 Key Discussion Points:
${state.transcript.map(t => `• ${t.speaker}: ${t.text}`).join('\n') || '• No transcript available yet'}

✅ Action Items:
• Follow up on discussed topics
• Review shared materials

⚠️ Add any API key (Groq, Gemini, OpenRouter, etc.) in .env for real AI summaries.`;
      }, 1500);
      return;
    }

    try {
      const transcriptText = state.transcriptForAI || state.transcript.map(t => `${t.speaker}: ${t.text}`).join('\n');
      const promptText = `Create a concise meeting summary with sections: Key Discussion Points, Decisions Made, Action Items, Follow-ups. Use bullet points and emoji.\n\nTranscript:\n${transcriptText}`;

      contentEl.innerHTML = '';
      const summaryText = await callLLM(null, promptText, 1500, null, (currentText) => {
        typeText(contentEl, currentText, 0, true);
      });
    } catch (err) {
      contentEl.innerHTML = `<span style="color: var(--danger)">Error: ${escapeHTML(err.message)}</span>`;
    }
  }

  // ─── AI Response UI Helpers ─────────────────────────────────────
  function createAIResponseElement(label, question) {
    const item = document.createElement('div');
    item.className = 'ai-item';
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="ai-item-header">
        <span class="ai-item-label">${escapeHTML(label)}</span>
        <span class="ai-item-time">${escapeHTML(time)}</span>
      </div>
      <div class="ai-item-question">${escapeHTML(question)}</div>
      <div class="ai-item-answer">
        <span class="thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>
      </div>
      <button class="item-copy-btn">📋</button>
    `;

    const copyBtn = item.querySelector('.item-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text = item.querySelector('.ai-item-answer').innerText;
        copyItemText(item, text);
      });
    }

    return item;
  }

  function addAIResponse(label, text) {
    clearEmptyState(dom.aiContent);
    const item = createAIResponseElement(label, '');
    dom.aiContent.appendChild(item);
    const answerEl = item.querySelector('.ai-item-answer');
    answerEl.innerHTML = '';
    typeText(answerEl, text, 0, true);
    dom.aiContent.scrollTop = dom.aiContent.scrollHeight;
    switchTab('ai-hints');
  }

  // ─── Typing Animation & Markdown Parsing ────────────────────────
  function typeText(element, text, speed = 8, useMarkdown = false) {
    if (speed === 0) {
      // Instant rendering
      if (useMarkdown) {
        element.innerHTML = parseMarkdown(text);
      } else {
        element.textContent = text;
      }

      if (state.settings.autoScrollAI ?? true) {
        const scrollParent = element.closest('.scrollable');
        if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight;
      }
      return;
    }

    let i = 0;
    element.innerHTML = '';
    // Increase chunk size to render words faster
    const chunkSize = useMarkdown ? 8 : 4;

    const timer = setInterval(() => {
      if (i < text.length) {
        element.textContent += text.substr(i, chunkSize);
        i += chunkSize;

        if (state.settings.autoScrollAI ?? true) {
          const scrollParent = element.closest('.scrollable');
          if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight;
        }
      } else {
        clearInterval(timer);
        if (useMarkdown) {
          element.innerHTML = parseMarkdown(text);
          if (state.settings.autoScrollAI ?? true) {
            const scrollParent = element.closest('.scrollable');
            if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight;
          }
        }
      }
    }, speed);
  }

  function parseMarkdown(text) {
    let html = escapeHTML(text);
    // Code blocks first — use non-greedy with length limit to prevent ReDoS
    html = html.replace(/```[a-z]{0,20}\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
    // Bold before italic — use [^*] to prevent catastrophic backtracking
    html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    html = html.replace(/^[-*] (.*$)/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');

    html = html.split('\n').map(line => {
      if (line.match(/^(<li|<h[1-3]|<pre)/)) return line;
      return line + '<br>';
    }).join('');

    html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (match, p1) => {
      return '<pre><code>' + p1.replace(/<br>/g, '\n') + '</code></pre>';
    });

    html = html.replace(/(<br>)+$/g, '');
    return html;
  }

  // ─── Session Timer ───────────────────────────────────────────────
  function startSessionTimer() {
    state.sessionStartTime = Date.now();
    dom.sessionTimer.classList.remove('hidden');
    updateTimerDisplay();
    state.sessionTimerInterval = setInterval(updateTimerDisplay, 1000);
  }

  function stopSessionTimer() {
    if (state.sessionTimerInterval) {
      clearInterval(state.sessionTimerInterval);
      state.sessionTimerInterval = null;
    }
    // Keep showing the final time
  }

  function updateTimerDisplay() {
    const elapsed = Math.floor((Date.now() - state.sessionStartTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    dom.sessionTimer.textContent = `${min}:${sec}`;
  }

  // ─── Export / Copy / Clear ──────────────────────────────────────
  function exportTranscript() {
    let content = '═══ Security Health Service — Session Export ═══\n';
    content += `Date: ${new Date().toLocaleString()}\n\n`;

    if (state.transcript.length > 0) {
      content += '── Transcript ──\n';
      state.transcript.forEach(t => {
        content += `[${t.time}] ${t.speaker}: ${t.text}\n`;
      });
      content += '\n';
    }

    if (state.aiResponses.length > 0) {
      content += '── AI Responses ──\n';
      state.aiResponses.forEach(r => {
        content += `Q: ${r.question}\nA: ${r.answer}\n\n`;
      });
    }

    if (!content.includes('──')) {
      showToast('Nothing to export yet', 'warning');
      return;
    }

    // Download as text file
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shs-session-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Session exported!', 'success');
  }

  function copyAllContent() {
    const panels = {
      'transcript': dom.transcriptContent,
      'ai-hints': dom.aiContent,
      'summary': dom.summaryContent,
      'screen-analysis': dom.screenContent,
    };

    const panel = panels[state.activeTab];
    if (!panel) return;

    const text = panel.innerText;
    if (!text || text.includes('will appear here') || text.includes('Start listening')) {
      showToast('Nothing to copy', 'warning');
      return;
    }

    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  }

  function clearCurrentPanel() {
    const panels = {
      'transcript': { el: dom.transcriptContent, icon: '🎤', msg: 'Start listening to see the live transcript here.', hint: 'Audio from your microphone & system will be transcribed in real-time.' },
      'ai-hints': { el: dom.aiContent, icon: '🧠', msg: 'AI-generated answers will appear here.', hint: 'The AI watches the conversation and suggests responses when it detects questions.' },
      'summary': { el: dom.summaryContent, icon: '📋', msg: 'Meeting summary will be generated here.', hint: 'Click "Ask AI" and type "summarize" to get a summary at any time.' },
      'screen-analysis': { el: dom.screenContent, icon: '🖥️', msg: 'Screen analysis results will appear here.', hint: 'Click "Screen" or press Ctrl+Shift+S to capture and analyze what\'s on your screen.' },
    };

    const config = panels[state.activeTab];
    if (!config) return;

    config.el.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">${config.icon}</span>
        <p>${config.msg}</p>
        <p class="hint">${config.hint}</p>
      </div>
    `;

    if (state.activeTab === 'transcript') {
      state.transcript = [];
      state.transcriptForAI = '';
    }
    if (state.activeTab === 'ai-hints') {
      state.aiResponses = [];
    }

    showToast('Panel cleared', 'info');
  }

  function copyItemText(item, fallbackText) {
    const text = fallbackText || item.innerText;
    const btn = item.querySelector('.item-copy-btn');

    navigator.clipboard.writeText(text).then(() => {
      if (btn) {
        btn.textContent = '✓';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋';
          btn.classList.remove('copied');
        }, 1500);
      }
    });
  }

  // ─── Status Management ──────────────────────────────────────────
  function setStatus(type, text) {
    dom.statusDot.className = `dot dot-${type}`;
    dom.statusText.textContent = text;
  }

  function updateAPIStatus() {
    if (state.envKeys.DEEPGRAM_API_KEY) {
      dom.deepgramStatus.textContent = '🎙️ ✓';
      dom.deepgramStatus.classList.add('connected');
    } else {
      dom.deepgramStatus.textContent = '🎙️ ─';
    }

    if (state.envKeys.GEMINI_API_KEY || state.envKeys.GROQ_API_KEY) {
      dom.openaiStatus.textContent = '🤖 ✓';
      dom.openaiStatus.classList.add('connected');
    } else {
      dom.openaiStatus.textContent = '🤖 ─';
    }
  }

  // ─── Toast Notifications ────────────────────────────────────────
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  }

  // ─── Utilities ─────────────────────────────────────────────
  function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function looksComplete(text) {
    if (!text) return false;
    const trimmed = text.trim();
    // Definitive end of sentence
    if (trimmed.endsWith('?') || trimmed.endsWith('.')) return true;
    
    // Check if it ends with a word that implies more is coming
    const words = trimmed.toLowerCase().split(/\s+/);
    if (words.length === 0) return false;
    const lastWord = words[words.length - 1];
    
    // Common conjunctions, prepositions, articles that indicate mid-sentence
    const incompleteEndings = new Set([
      'and', 'or', 'but', 'so', 'because', 'although', 'if', 'when',
      'the', 'a', 'an', 'some', 'any',
      'of', 'in', 'on', 'with', 'about', 'between', 'for', 'to', 'from',
      'is', 'are', 'was', 'were', 'will', 'would', 'could', 'should',
      'like', 'such', 'than', 'that', 'which', 'while', 'using', 'versus'
    ]);
    
    return !incompleteEndings.has(lastWord);
  }

  function hasAnyAPIKey() {
    return state.envKeys.GEMINI_API_KEY || state.envKeys.VERTEX_API_KEY || state.envKeys.GROQ_API_KEY ||
      state.envKeys.OPENROUTER_API_KEY || state.envKeys.TOGETHER_API_KEY ||
      state.envKeys.MISTRAL_API_KEY || state.envKeys.COHERE_API_KEY;
  }

  // ─── Auto Screen Watch (Feature 6 — Universal Question Detection) ───────
  //
  // ARCHITECTURE (2-phase dedup pipeline):
  //   Phase 0: Perceptual hash — if the screen pixels haven't changed at all, skip.
  //   Phase 1: Cheap AI call — "Extract the question visible on screen" (~100 tokens).
  //            If no question found → skip. If same question as last time → skip.
  //   Phase 2: Full AI call — generate the complete answer using the existing
  //            analyzeScreenWithAI() prompt (supports coding, design, behavioral, etc).
  //
  // This means:
  //   ✓ Detects ANY question type (coding platforms, chatbox, AI interview, etc.)
  //   ✓ Never re-answers the same question even if pixels change slightly
  //   ✓ Cheap Phase-1 call saves API budget when screen hasn't changed meaningfully

  function startAutoScreenWatch() {
    if (state.autoScreenWatchInterval) return; // already running
    if (!hasAnyAPIKey()) {
      showToast('Add an API key for auto-screen watch', 'warning');
      return;
    }

    state.autoScreenWatchInterval = setInterval(async () => {
      // Guard: don't overlap if a previous cycle is still in-flight
      if (state.autoScreenBusy) return;
      state.autoScreenBusy = true;

      try {
        // ── Capture the screen ──────────────────────────────────────
        const sources = await window.electronAPI.getDesktopSources();
        if (!sources || sources.length === 0) return;

        const screenSource = sources.find(s => s.id.startsWith('screen:') || s.name === 'Entire Screen')
          || sources.find(s => !s.name.includes('Security Health') && !s.name.includes('EliteCODE'))
          || sources[0];

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screenSource.id } },
        });

        const video = document.createElement('video');
        video.srcObject = stream;
        try { await video.play(); } catch { stream.getTracks().forEach(t => t.stop()); return; }

        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 768 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        stream.getTracks().forEach(t => t.stop());
        video.srcObject = null;

        // ── Phase 0: Perceptual hash — skip if screen is visually identical ──
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hash = perceptualImageHash(imageData);

        if (state.lastScreenHash && isScreenUnchanged(hash, state.lastScreenHash)) {
          // Screen is truly unchanged — skip
          return;
        }
        state.lastScreenHash = hash;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);

        // ── Phase 1: Cheap extraction — find the question on screen ──────
        const extractionPrompt = `You are a screen content analyzer. Your ONLY job is to find and extract any QUESTION visible on this screen.

A question can appear anywhere:
- A coding problem on LeetCode, HackerRank, CodeSignal, or any coding platform
- A question typed in a chat window or chatbox (Zoom chat, Teams chat, Slack, Discord, etc.)
- A question asked by an AI interviewer on any interview platform
- A question visible in a document, presentation, or shared screen
- A question displayed as a prompt or instruction on any website or application
- A verbal question shown as captions or subtitles

RULES:
1. If you find a question, respond with ONLY the question text — nothing else. Extract it exactly as written.
2. If there are multiple questions, extract the most prominent/recent one (usually the last or largest one).
3. For coding problems, include the full problem statement (description + constraints + examples if visible).
4. If there is NO question on screen, respond with exactly: NO_QUESTION
5. Do NOT add commentary, explanation, or formatting. Just the raw question text.`;

        const extractedQuestion = await callLLM(null, extractionPrompt, 300, dataUrl, null);

        // No question found on screen → skip
        if (!extractedQuestion || extractedQuestion.trim() === 'NO_QUESTION' || extractedQuestion.trim().length < 10) {
          return;
        }

        const cleanQuestion = extractedQuestion.trim();

        // ── Dedup: Compare with previously detected question ─────────
        if (state.lastDetectedQuestion && questionIsSame(state.lastDetectedQuestion, cleanQuestion)) {
          // Same question as before — don't regenerate
          return;
        }

        // It's a NEW question! Update the tracker
        state.lastDetectedQuestion = cleanQuestion;

        // ── Phase 2: Full answer generation ──────────────────────────
        // Re-capture at higher quality for the full analysis
        const hiResDataUrl = canvas.toDataURL('image/jpeg', 0.6);

        switchTab('screen-analysis');
        clearEmptyState(dom.screenContent);

        const item = document.createElement('div');
        item.className = 'screen-item';
        const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        // Classify the detected question for the label
        const qType = classifyQuestion(cleanQuestion);
        const labelEmoji = qType === 'CODE' ? '💻' : qType === 'DESIGN' ? '🏗️' : qType === 'BEHAVIORAL' ? '🗣️' : qType === 'IMPLEMENTATION' ? '🛠️' : '❓';
        const labelText = qType === 'CODE' ? 'Coding Problem' : qType === 'DESIGN' ? 'System Design' : qType === 'BEHAVIORAL' ? 'Behavioral Question' : qType === 'IMPLEMENTATION' ? 'Implementation Task' : 'Question Detected';

        item.innerHTML = `
          <div class="screen-item-header">
            <span class="screen-item-label">🔍 Auto: ${labelEmoji} ${escapeHTML(labelText)}</span>
            <span class="screen-item-time">${escapeHTML(time)}</span>
          </div>
          <img class="screen-item-preview" src="${hiResDataUrl}" alt="Auto-captured" style="max-height:80px;" />
          <div class="screen-item-question" style="padding:6px 10px;font-size:12px;color:#a1a1aa;border-bottom:1px solid rgba(255,255,255,0.05);">
            <strong>Detected:</strong> ${escapeHTML(cleanQuestion.length > 200 ? cleanQuestion.slice(0, 200) + '…' : cleanQuestion)}
          </div>
          <div class="screen-item-analysis">
            <span class="thinking">
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
            </span> Generating answer...
          </div>
        `;
        dom.screenContent.appendChild(item);
        dom.screenContent.scrollTop = dom.screenContent.scrollHeight;

        const analysisEl = item.querySelector('.screen-item-analysis');

        // Use the full analyzeScreenWithAI flow for the answer
        await analyzeScreenWithAI(hiResDataUrl, analysisEl);

        showToast(`🔍 ${labelEmoji} ${labelText} detected on screen!`, 'success');

      } catch (err) {
        console.warn('Auto screen watch error:', err.message);
      } finally {
        state.autoScreenBusy = false;
      }
    }, 4000); // every 4 seconds — Phase 0 hash filter keeps token cost low

    showToast('👁️ Screen watch active — monitoring for any questions', 'info');
  }

  function stopAutoScreenWatch() {
    if (state.autoScreenWatchInterval) {
      clearInterval(state.autoScreenWatchInterval);
      state.autoScreenWatchInterval = null;
    }
    state.autoScreenBusy = false;
  }

  // ─── Question Deduplication ─────────────────────────────────────────
  // Normalized comparison: strips formatting, lowercases, compares tokens.
  // If >75% of tokens overlap, we consider it the same question.
  function questionIsSame(prevQuestion, newQuestion) {
    const normalize = (text) => text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')   // strip punctuation
      .replace(/\s+/g, ' ')           // collapse whitespace
      .trim();

    const prev = normalize(prevQuestion);
    const next = normalize(newQuestion);

    // Exact match (common case)
    if (prev === next) return true;

    // Token overlap — handles minor differences (extra whitespace, truncation, etc.)
    const prevTokens = new Set(prev.split(' ').filter(t => t.length > 2));
    const nextTokens = new Set(next.split(' ').filter(t => t.length > 2));

    if (prevTokens.size === 0 || nextTokens.size === 0) return false;

    let overlap = 0;
    for (const token of nextTokens) {
      if (prevTokens.has(token)) overlap++;
    }

    const similarity = overlap / Math.max(prevTokens.size, nextTokens.size);
    return similarity > 0.75;
  }

  // ─── Perceptual Image Hash (block-based) ────────────────────────────
  // Divides the image into an 8x8 grid of blocks, computes average brightness
  // per block. Returns a 64-element array that can be compared with cosine
  // similarity. Much more robust than the old single-number hash.
  function perceptualImageHash(imageData) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const gridSize = 8;
    const blockW = Math.floor(w / gridSize);
    const blockH = Math.floor(h / gridSize);
    const hash = new Float32Array(gridSize * gridSize);

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        let sum = 0;
        let count = 0;
        const startX = gx * blockW;
        const startY = gy * blockH;
        // Sample every 4th pixel in the block for speed
        for (let y = startY; y < startY + blockH; y += 4) {
          for (let x = startX; x < startX + blockW; x += 4) {
            const idx = (y * w + x) * 4;
            if (idx < data.length - 2) {
              sum += data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
              count++;
            }
          }
        }
        hash[gy * gridSize + gx] = count > 0 ? sum / count : 0;
      }
    }
    return hash;
  }

  // Dual-check: catches BOTH major screen changes AND localized changes
  // (e.g. a new chat message in one corner while the rest of the screen is identical)
  function isScreenUnchanged(newHash, oldHash) {
    // Check 1: Overall cosine similarity (catches major layout changes)
    const similarity = imageSimilarity(newHash, oldHash);
    if (similarity < 0.90) return false; // Major change — definitely different

    // Check 2: Max block delta (catches localized changes like a new chatbox message)
    // A cursor blink changes a block by ~3-5 brightness units.
    // A new question/text appearing changes a block by 20+ brightness units.
    // Threshold of 15 filters noise while catching real content updates.
    let maxDelta = 0;
    for (let i = 0; i < newHash.length; i++) {
      const delta = Math.abs(newHash[i] - oldHash[i]);
      if (delta > maxDelta) maxDelta = delta;
    }
    if (maxDelta > 15) return false; // Localized change detected

    // Both checks passed — screen is truly unchanged
    return true;
  }

  // Cosine similarity between two perceptual hashes (0 = different, 1 = identical)
  function imageSimilarity(hashA, hashB) {
    if (!hashA || !hashB || hashA.length !== hashB.length) return 0;
    let dotProduct = 0, magA = 0, magB = 0;
    for (let i = 0; i < hashA.length; i++) {
      dotProduct += hashA[i] * hashB[i];
      magA += hashA[i] * hashA[i];
      magB += hashB[i] * hashB[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    if (magA === 0 || magB === 0) return 0;
    return dotProduct / (magA * magB);
  }

  // ─── Start ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
