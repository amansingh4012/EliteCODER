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
    audioContext: null,
    analyserNode: null,
    animationFrameId: null,
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
      captureMic: true
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
    showToast('Ready! Press Start to begin.', 'info');
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
      document.getElementById('app').style.filter = `opacity(${val})`;
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
        // Update trigger text
        dom.modelDropdownTrigger.textContent = label;
        // Update selected state
        dom.modelDropdownList.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        // Update state
        state.settings.model = value;
        // Close dropdown
        dom.modelDropdown.classList.remove('open');
      });
    }
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (dom.modelDropdown && !dom.modelDropdown.contains(e.target)) {
        dom.modelDropdown.classList.remove('open');
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
        case 'M': // Generate summary
          e.preventDefault();
          switchTab('summary');
          generateSummary();
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

  // ─── Window Controls ────────────────────────────────────────────
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

    if (dom.toggleMic) dom.toggleMic.checked = state.settings.captureMic ?? true;

    dom.toggleSound.checked = state.settings.soundNotifications;
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
        // We have both, mix them
        const audioContext = new AudioContext();
        const dest = audioContext.createMediaStreamDestination();
        audioContext.createMediaStreamSource(micStream).connect(dest);
        audioContext.createMediaStreamSource(new MediaStream(desktopStream.getAudioTracks())).connect(dest);
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
          state.transcriptForAI += `${speaker}: ${text}\n`;

          // Smart question detection — behavioral, technical, coding
          // Require questions to be at least 4 words so we ignore "What?", "Excuse me?", "Can you repeat that?"
          const wordCount = text.trim().split(/\s+/).length;
          const isQuestion = wordCount >= 4 && (text.includes('?') ||
            /\b(tell me|describe|explain|how (do|would|did|could)|what (is|are|was|were|would)|why (do|did|would)|walk me|give me an example|have you ever)\b/i.test(text));

          const hasAnyKey = state.envKeys.GEMINI_API_KEY || state.envKeys.VERTEX_API_KEY || state.envKeys.GROQ_API_KEY ||
            state.envKeys.OPENROUTER_API_KEY || state.envKeys.TOGETHER_API_KEY ||
            state.envKeys.MISTRAL_API_KEY || state.envKeys.COHERE_API_KEY;

          if (isQuestion && state.settings.autoDetect && hasAnyKey) {
            state.pendingQuestion = text;
          } else if (state.pendingQuestion) {
            // Append subsequent context if they keep talking after a question
            state.pendingQuestion += ' ' + text;
          }
        } else {
          updatePartialTranscript(text);
        }

        // Delay the AI hint until the speaker fully pauses for 1.2 seconds 
        if (state.pendingQuestion && state.settings.autoDetect) {
          clearTimeout(state.questionDebounce);
          state.questionDebounce = setTimeout(() => {
            autoGenerateHint(state.pendingQuestion);
            state.pendingQuestion = null;
          }, 1200);
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

    const mediaRecorder = new MediaRecorder(state.mediaStream, {
      mimeType: 'audio/webm;codecs=opus',
    });
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

      // Capture via desktopCapturer
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0].id,
          },
        },
      });

      // Grab a frame
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      // Resize to max 1024px to keep under API limits
      const maxWidth = 1024;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Stop the stream
      stream.getTracks().forEach(t => t.stop());

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
      const context = buildSystemPrompt(false); // Do not include the audio transcript
      const userPrompt = `You are a system security analyzer interpreting user screen activity. ${context}\n\nAnalyze this screen capture carefully. If you see:\n- A CODING PROBLEM: Provide the solution with explanation and time/space complexity\n- A SYSTEM DESIGN diagram: Explain the architecture and suggest improvements\n- A PRESENTATION/DOCUMENT: Summarize key points and suggest talking points\n- A VIDEO CALL: Identify what's being discussed and provide relevant insights\n\nBe thorough and specific in your analysis.`;

      outputEl.innerHTML = '';
      const responseText = await callLLM(null, userPrompt, 1500, imageDataUrl, (currentText) => {
        typeText(outputEl, currentText, 0, true);
      });
      state.lastScreenAnalysisText = responseText;
    } catch (err) {
      outputEl.innerHTML = `<span style="color: var(--danger)">Error: ${escapeHTML(err.message)}<br><small>Note: You may be using a model that does not natively support Vision/Image requests. Please pick a Vision model from OpenRouter or Gemini.</small></span>`;
    }
  }

  // ─── AI Integration (Google Gemini) ─────────────────────────────
  function buildSystemPrompt(includeTranscript = true) {
    let prompt = "";

    if (state.settings.detailedMode) {
      prompt = `You are a world-class Senior Software Engineer acting as a mentor in an interview. Your job is to provide incredibly comprehensive, deeply detailed, and perfectly formatted answers.
CRITICAL RULES FOR DETAILED MODE:
1. Break down the answer into structured, logical sections using markdown headings.
2. Provide code examples, real-world analogies, and explain the "Why" behind the "What".
3. Use bolding to highlight key technical terms.
4. Go far beyond a surface-level answer—be exhaustive and demonstrate deep mastery.`;
    } else {
      prompt = `You are a real-time smart assistant for software engineering interviews. Your job is to provide EXACT, DIRECT answers that sound completely natural, exactly as a candidate would speak them out loud.
CRITICAL RULES FOR INTERVIEW MODE:
1. NO FLUFF. Start with the exact answer immediately. No "Here is the code" or "Certainly".
2. Write in a conversational, spoken tone. Your text should look like a script for the candidate to read directly.
3. Structure answers beautifully using bolding for emphasis.
4. Keep the entire response extremely concise. The user is in a live interview and needs to read it fast.`;

      // Dynamic Intent Strictness Formatting
      if (state.settings.strictCode) {
        prompt += `\n- IF ASKED FOR CODE: Output the code block. Below the code, write exactly 1-2 natural sentences of what the candidate should SAY OUT LOUD to explain the logic to the interviewer.`;
      }
      if (state.settings.strictCompare) {
        prompt += `\n- IF ASKED FOR A DIFFERENCE/COMPARISON: Write a natural, spoken-style comparison that the candidate can read directly to the interviewer in 2-3 short bullet points. Do not include introductory filler.`;
      }
      if (state.settings.strictExplain) {
        prompt += `\n- IF ASKED FOR AN EXPLANATION: Provide a conversational explanation that the candidate can naturally speak out loud. Limit to EXACTLY 2-3 short bullet points. Do not write lengthy paragraphs.`;
      }
    }

    if (state.settings.useScreenContext && state.lastScreenAnalysisText) {
      prompt += `\n\n🖼️ PREVIOUS SCREEN CAPTURE ANALYSIS:\n${state.lastScreenAnalysisText}\n\nIMPORTANT: The user previously captured their screen and the AI analyzed it. The text above is the result of that analysis. If the user's question relates to a coding problem, diagram, or context visible on their screen, use this analysis to answer their question accurately.`;
    }

    if (state.settings.resume) {
      prompt += `\n\n💼 USER'S BACKGROUND/RESUME:\n${state.settings.resume}\n\nIMPORTANT: ONLY use or reference this resume if the question explicitly asks about the user's past projects, past experience, or resume. Otherwise, ignore it completely and answer the question universally.`;
    }
    if (state.settings.jobDescription) {
      prompt += `\n\n🎯 TARGET JOB DESCRIPTION:\n${state.settings.jobDescription}\n\nIMPORTANT: Align answers with the key requirements, technologies, and values mentioned in this job description.`;
    }
    if (state.settings.customInstructions) {
      prompt += `\n\n⚙️ CUSTOM INSTRUCTIONS:\n${state.settings.customInstructions}`;
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
      const systemPrompt = buildSystemPrompt();
      // Render formatted text efficiently
      answerEl.innerHTML = '';
      const responseText = await callLLM(systemPrompt, question, 1200, null, (currentText) => {
        typeText(answerEl, currentText, 0, true);
      });

      dom.openaiStatus.textContent = '🤖 ✓';
      dom.openaiStatus.classList.add('connected');

      state.aiResponses.push({ question, answer: responseText });
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
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      };
      parseResponse = (data) => data.candidates?.[0]?.content?.parts?.[0]?.text;
    }
    // 2. OpenAI-Compatible Providers (Groq, Together, Mistral, OpenRouter, Cohere)
    else {
      payload = {
        model: model,
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: []
      };
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
        <span class="ai-item-label">${label}</span>
        <span class="ai-item-time">${time}</span>
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
    html = html.replace(/```[a-z]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
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

  // ─── Utilities ──────────────────────────────────────────────────
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Start ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
