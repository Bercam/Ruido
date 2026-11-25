import { loadCache, persistCache, STORAGE_KEY } from './state/persistence';
import { captureProfileSettings } from './state/profiles';

let ytApiReady = false;
  const ytReadyCallbacks = [];

  window.onYouTubeIframeAPIReady = function() {
    ytApiReady = true;
    while (ytReadyCallbacks.length > 0) {
      const fn = ytReadyCallbacks.shift();
      try { fn(); } catch (e) {}
    }
  };

  (function loadYouTubeApiScript() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  })();

  function runWhenYtReady(cb) {
    if (ytApiReady && window.YT && window.YT.Player) cb();
    else ytReadyCallbacks.push(cb);
  }

  function createManagedYouTubePlayer(videoId, initialVol0to100, onErrorCb) {
    const holder = document.createElement('div');
    holder.id = 'yt_slot_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    hiddenMediaDock.appendChild(holder);

    const state = {
      holder,
      player: null,
      targetVol: Math.max(0, Math.min(100, Math.round(initialVol0to100))),
      destroyed: false
    };

    runWhenYtReady(() => {
      if (state.destroyed) return;
      state.player = new YT.Player(holder.id, {
        height: '200',
        width: '200',
        videoId: videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          loop: 1,
          playlist: videoId,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin
        },
        events: {
          onReady: (ev) => {
            if (state.destroyed) return;
            try {
              ev.target.setVolume(state.targetVol);
              ev.target.playVideo();
            } catch (e) {}
          },
          onStateChange: (ev) => {
            if (state.destroyed) return;
            if (ev.data === YT.PlayerState.ENDED) {
              try {
                ev.target.seekTo(0);
                ev.target.playVideo();
              } catch (e) {}
            }
          },
          onError: (ev) => {
            if (onErrorCb) onErrorCb(ev.data);
          }
        }
      });
    });

    return {
      setVolume(vol0to100) {
        state.targetVol = Math.max(0, Math.min(100, Math.round(vol0to100)));
        if (state.player && typeof state.player.setVolume === 'function') {
          try { state.player.setVolume(state.targetVol); } catch (e) {}
        }
      },
      destroy() {
        state.destroyed = true;
        if (state.player && typeof state.player.destroy === 'function') {
          try { state.player.destroy(); } catch (e) {}
        }
        try { holder.remove(); } catch (e) {}
      }
    };
  }

  const DB_NAME = 'RuidoAmbientalMediaDB';
  const DB_STORE = 'localFiles';
  const localBlobUrlCache = {};

  function openMediaDB(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveLocalBlobToDB(id, fileBlob) {
    try {
      if (localBlobUrlCache[id]) {
        URL.revokeObjectURL(localBlobUrlCache[id]);
        delete localBlobUrlCache[id];
      }
      const db = await openMediaDB();
      return new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(fileBlob, id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { return false; }
  }

  async function getLocalBlobUrlFromDB(id) {
    if (localBlobUrlCache[id]) return localBlobUrlCache[id];
    try {
      const db = await openMediaDB();
      return new Promise<string | null>(resolve => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(id);
        req.onsuccess = () => {
          if (req.result) {
            const url = URL.createObjectURL(req.result);
            localBlobUrlCache[id] = url;
            resolve(url);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  async function deleteLocalBlobFromDB(id) {
    try {
      if (localBlobUrlCache[id]) {
        URL.revokeObjectURL(localBlobUrlCache[id]);
        delete localBlobUrlCache[id];
      }
      const db = await openMediaDB();
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
    } catch (e) {}
  }

  function extractYouTubeId(url) {
    if (!url) return null;
    const clean = url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
    const m = clean.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  type SoundDefinition = {
    id: string;
    name: string;
    sub: string;
    icon: string;
    toneLabel: string | null;
    defaultVol: number;
    defaultTone: number;
    gainScale?: number;
    isCustom: boolean;
    sourceType?: string;
    youtubeId?: string;
    fileName?: string;
  };

  const BUILTIN_SOUNDS: SoundDefinition[] = [
    { id: 'rain', name: 'Chuva', sub: 'Chuva ampla com gotas irregulares e filtragem suave', icon: '🌧️', toneLabel: 'Intensidade', defaultVol: 45, defaultTone: 55, gainScale: 1, isCustom: false },
    { id: 'wind', name: 'Vento', sub: 'Rajadas lentas com variação contínua', icon: '🍃', toneLabel: 'Rajadas', defaultVol: 35, defaultTone: 40, gainScale: 1.3, isCustom: false },
    { id: 'waterfall', name: 'Cachoeira', sub: 'Água corrente com graves suaves', icon: '🌊', toneLabel: 'Profundidade', defaultVol: 40, defaultTone: 50, gainScale: 0.9, isCustom: false },
    { id: 'birds', name: 'Pássaros', sub: 'Pios variados com harmônicos e ambiência suave', icon: '🐦', toneLabel: 'Frequência', defaultVol: 30, defaultTone: 50, gainScale: 0.45, isCustom: false },
    { id: 'cicadas', name: 'Cigarras', sub: 'Canto contínuo de fim de tarde', icon: '🦗', toneLabel: 'Cadência', defaultVol: 25, defaultTone: 45, gainScale: 0.28, isCustom: false },
    { id: 'ocean', name: 'Ondas do mar', sub: 'Ondas longas com espuma e movimento natural', icon: '🏖️', toneLabel: 'Força das ondas', defaultVol: 32, defaultTone: 45, gainScale: 0.85, isCustom: false },
    { id: 'stream', name: 'Riacho', sub: 'Água corrente brilhante e tranquila', icon: '💧', toneLabel: 'Brilho da água', defaultVol: 30, defaultTone: 55, gainScale: 0.7, isCustom: false },
    { id: 'fireplace', name: 'Lareira', sub: 'Crepitar espaçado sobre um calor grave', icon: '🔥', toneLabel: 'Estalos', defaultVol: 24, defaultTone: 42, gainScale: 0.35, isCustom: false },
    { id: 'thunder', name: 'Trovão distante', sub: 'Rolos graves e espaçados para misturar à chuva', icon: '⛈️', toneLabel: 'Distância', defaultVol: 20, defaultTone: 50, gainScale: 0.45, isCustom: false }
  ];

  const DEFAULT_NATURE_STATE = {
    rain:      { enabled: false, volume: 45, tone: 55 },
    wind:      { enabled: false, volume: 35, tone: 40 },
    waterfall: { enabled: false, volume: 40, tone: 50 },
    birds:     { enabled: false, volume: 30, tone: 50 },
    cicadas:   { enabled: false, volume: 25, tone: 45 },
    ocean:     { enabled: false, volume: 32, tone: 45 },
    stream:    { enabled: false, volume: 30, tone: 55 },
    fireplace: { enabled: false, volume: 24, tone: 42 },
    thunder:   { enabled: false, volume: 20, tone: 50 }
  };

  const EQ_BANDS = [
    { label: 'Graves', freq: 60, q: 0.9 },
    { label: 'Baixo', freq: 170, q: 1.0 },
    { label: 'Corpo', freq: 420, q: 1.0 },
    { label: 'Médio', freq: 1200, q: 1.0 },
    { label: 'Presença', freq: 3500, q: 1.1 },
    { label: 'Agudos', freq: 10000, q: 0.9 }
  ];

  const EQ_PRESETS = {
    'Plano':      [0, 0, 0, 0, 0, 0],
    'Relax':      [4, 2, 0, -1, -2, -3],
    'Voz':        [-2, -1, 1, 4, 3, 0],
    'Graves':     [7, 5, 2, 0, -1, -2],
    'Agudos':     [-2, -1, 0, 1, 4, 6],
    'Noturno':    [3, 1, -1, -3, -2, 2]
  };

  const DEFAULT_SETTINGS = {
    autoPlay: false,
    autoPip: false,
    startCompact: false,
    runInBackground: true,
    uiLocked: false,
    scrollStep: 2
  };

  const DEFAULT_PROFILES = [
    {
      id: 'p_foco',
      name: 'Foco',
      icon: '🎧',
      color: '#8ab4f8',
      noiseType: 'brown',
      masterVolume: 100,
      volume: 37,
      cutoffFreq: 276,
      polish: 85,
      timerMinutes: 0,
      nature: JSON.parse(JSON.stringify(DEFAULT_NATURE_STATE))
    },
    {
      id: 'p_chuva',
      name: 'Chuva',
      icon: '🌧️',
      color: '#f28b82',
      noiseType: 'pink',
      masterVolume: 100,
      volume: 25,
      cutoffFreq: 900,
      polish: 110,
      timerMinutes: 30,
      nature: {
        rain: { enabled: true, volume: 65, tone: 60 },
        wind: { enabled: true, volume: 30, tone: 35 },
        waterfall: { enabled: false, volume: 40, tone: 50 },
        birds: { enabled: false, volume: 30, tone: 50 },
        cicadas: { enabled: false, volume: 25, tone: 45 }
      }
    },
    {
      id: 'p_floresta',
      name: 'Natureza',
      icon: '🌿',
      color: '#81c995',
      noiseType: 'green',
      masterVolume: 100,
      volume: 20,
      cutoffFreq: 650,
      polish: 120,
      timerMinutes: 45,
      nature: {
        rain: { enabled: false, volume: 45, tone: 55 },
        wind: { enabled: true, volume: 35, tone: 40 },
        waterfall: { enabled: true, volume: 40, tone: 45 },
        birds: { enabled: true, volume: 38, tone: 55 },
        cicadas: { enabled: true, volume: 22, tone: 40 }
      }
    }
  ];

  const GOOGLE_COLORS = [
    '#8ab4f8', '#f28b82', '#fdd663', '#81c995',
    '#c58af9', '#78d9ec', '#ff8bcb', '#fcad70'
  ];
  const PROFILE_ICONS = ['🎧', '🌧️', '🌿', '🌊', '🌙', '🔥', '☕', '💤', '🏞️', '🎹', '🧘', '📚'];
  const LEGACY_PROFILE_ICONS = {
    p_foco: '🎧',
    p_chuva: '🌧️',
    p_floresta: '🌿'
  };

  const DEFAULT_CACHE = {
    noiseType: 'brown',
    masterVolume: 100,
    volume: 37,
    cutoffFreq: 276,
    polish: 85,
    timerMinutes: 0,
    activeProfileId: 'p_foco',
    playing: false,
    nature: JSON.parse(JSON.stringify(DEFAULT_NATURE_STATE)),
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    eqGains: EQ_PRESETS['Plano'].slice(),
    profiles: DEFAULT_PROFILES,
    customNoises: [],
    customSounds: []
  };

  let appState = loadCache(DEFAULT_CACHE);
  let lastAppliedProfileId = appState.activeProfileId || null;
  appState.eqGains = Array.isArray(appState.eqGains) && appState.eqGains.length === EQ_BANDS.length
    ? appState.eqGains.map(value => Math.max(-12, Math.min(12, Number(value) || 0)))
    : EQ_PRESETS['Plano'].slice();
  const isAudioHost = new URLSearchParams(location.search).has('audiohost');
  let lastServerCommandSeq = 0;

  function getAllSoundDefs(): SoundDefinition[] {
    const customs = (appState.customSounds || []).map(cs => ({
      id: cs.id,
      name: cs.name,
      sub: cs.sourceType === 'youtube' ? 'YouTube em loop contínuo' : `Arquivo local (${cs.fileName || 'Áudio'})`,
      icon: cs.sourceType === 'youtube' ? '▶️' : '🎵',
      toneLabel: cs.sourceType === 'local' ? 'Tom' : null,
      defaultVol: 50,
      defaultTone: 50,
      isCustom: true,
      sourceType: cs.sourceType,
      youtubeId: cs.youtubeId,
      fileName: cs.fileName
    }));
    return [...BUILTIN_SOUNDS, ...customs];
  }

  function saveCache(showSettingsToast = false) {
    const saved = persistCache({
      noiseType: noiseType,
      masterVolume: Math.round(masterVolume * 100),
      volume: Math.round(volume * 100),
      cutoffFreq: cutoffFreq,
      polish: polishLevel,
      timerMinutes: configuredTimerMinutes,
      activeProfileId: appState.activeProfileId,
      playing: isPlaying,
      nature: appState.nature,
      settings: appState.settings,
      eqGains: appState.eqGains,
      profiles: appState.profiles,
      customNoises: appState.customNoises,
      customSounds: appState.customSounds
    });
    if (saved) {
      const toast = document.getElementById('settingsSavedToast');
      if (toast) {
        toast.classList.remove('error');
        if (showSettingsToast) {
          toast.textContent = '✓ Configuração salva';
          toast.classList.add('show');
          clearTimeout(window._toastTimer);
          window._toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
        } else {
          toast.classList.remove('show');
        }
      }
    } else {
      const toast = document.getElementById('settingsSavedToast');
      if (toast) {
        toast.textContent = 'Não foi possível salvar as configurações';
        clearTimeout(window._toastTimer);
        toast.classList.add('error', 'show');
        window._toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
      }
    }
  }

  let audioCtx = null;
  let noiseNode = null;
  let customNoiseMediaEl = null;
  let customNoiseMediaSrc = null;
  let customNoiseYtController = null;

  let hpCleanFilter = null;
  let notchHarshFilter = null;
  let notchSibilanceFilter = null;
  let lpFilterNode = null;
  let velvetLpFilter = null;
  let noiseGainNode = null;
  let masterGainNode = null;
  let masterAnalyser = null;
  let masterCompressor = null;
  let eqInputNode = null;
  const eqFilters = [];

  let isPlaying = false;
  let noiseType = appState.noiseType;
  let masterVolume = appState.masterVolume / 100;
  let volume = appState.volume / 100;
  let cutoffFreq = appState.cutoffFreq;
  let polishLevel = appState.polish;
  let configuredTimerMinutes = appState.timerMinutes;
  let remainingSeconds = configuredTimerMinutes * 60;
  let pipWindowRef = null;

  const natureEngines = {};
  const hiddenMediaDock = document.getElementById('hiddenMediaDock');

  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = Math.max(0.0001, masterVolume);

      masterCompressor = audioCtx.createDynamicsCompressor();
      masterCompressor.threshold.value = -16;
      masterCompressor.knee.value = 26;
      masterCompressor.ratio.value = 3;
      masterCompressor.attack.value = 0.01;
      masterCompressor.release.value = 0.22;

      masterAnalyser = audioCtx.createAnalyser();
      masterAnalyser.fftSize = 1024;
      masterAnalyser.smoothingTimeConstant = 0.72;

      eqInputNode = audioCtx.createGain();
      eqFilters.length = 0;
      let eqTail = eqInputNode;
      EQ_BANDS.forEach((band, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = band.freq;
        filter.Q.value = band.q;
        filter.gain.value = (appState.eqGains && appState.eqGains[i]) || 0;
        eqTail.connect(filter);
        eqTail = filter;
        eqFilters.push(filter);
      });
      eqTail.connect(masterGainNode);

      masterCompressor.connect(eqInputNode);
      masterGainNode.connect(masterAnalyser);
      masterAnalyser.connect(audioCtx.destination);

      hpCleanFilter = audioCtx.createBiquadFilter();
      hpCleanFilter.type = 'highpass';

      notchHarshFilter = audioCtx.createBiquadFilter();
      notchHarshFilter.type = 'peaking';
      notchHarshFilter.frequency.value = 3400;
      notchHarshFilter.Q.value = 1.1;

      notchSibilanceFilter = audioCtx.createBiquadFilter();
      notchSibilanceFilter.type = 'peaking';
      notchSibilanceFilter.frequency.value = 6200;
      notchSibilanceFilter.Q.value = 0.9;

      lpFilterNode = audioCtx.createBiquadFilter();
      lpFilterNode.type = 'lowpass';
      lpFilterNode.frequency.value = cutoffFreq;

      velvetLpFilter = audioCtx.createBiquadFilter();
      velvetLpFilter.type = 'lowpass';
      velvetLpFilter.frequency.value = 20000;

      noiseGainNode = audioCtx.createGain();
      noiseGainNode.gain.value = 0.0001;

      hpCleanFilter.connect(notchHarshFilter);
      notchHarshFilter.connect(notchSibilanceFilter);
      notchSibilanceFilter.connect(lpFilterNode);
      lpFilterNode.connect(velvetLpFilter);
      velvetLpFilter.connect(noiseGainNode);
      noiseGainNode.connect(masterCompressor);

      applyPolishParameters();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function applyPolishParameters() {
    if (!audioCtx || !hpCleanFilter) return;
    const p = polishLevel / 100;
    const basePart = Math.min(1.0, p);
    const ultraPart = Math.max(0.0, p - 1.0);

    hpCleanFilter.frequency.setTargetAtTime(20 + basePart * 55 + ultraPart * 20, audioCtx.currentTime, 0.03);
    notchHarshFilter.gain.setTargetAtTime(-(basePart * 12 + ultraPart * 6), audioCtx.currentTime, 0.03);
    notchSibilanceFilter.gain.setTargetAtTime(-(Math.max(0, p - 0.6) * 10), audioCtx.currentTime, 0.03);
    lpFilterNode.Q.setTargetAtTime(Math.max(0.25, 0.72 - basePart * 0.35 - ultraPart * 0.12), audioCtx.currentTime, 0.03);

    const velvetFreq = ultraPart > 0
      ? Math.max(180, cutoffFreq * (1.35 - ultraPart * 0.45))
      : 20000;
    velvetLpFilter.frequency.setTargetAtTime(velvetFreq, audioCtx.currentTime, 0.03);
  }

  function applyEqGains() {
    if (!audioCtx || eqFilters.length !== EQ_BANDS.length) return;
    const now = audioCtx.currentTime;
    eqFilters.forEach((filter, i) => {
      const gain = typeof appState.eqGains[i] === 'number' ? appState.eqGains[i] : 0;
      filter.gain.setTargetAtTime(gain, now, 0.03);
    });
    drawEqCurve();
  }

  function createNoiseBuffer(context, type) {
    const bufferSize = context.sampleRate * 3;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    if (type === 'white') {
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.42;
    } else if (type === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
        b6 = white * 0.115926;
      }
    } else if (type === 'brown') {
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 2.8;
      }
    } else if (type === 'green') {
      let bp1 = 0, bp2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        bp1 += 0.07 * (white - bp1);
        bp2 += 0.07 * (bp1 - bp2);
        data[i] = (bp1 - bp2) * 2.4;
      }
    } else if (type === 'grey') {
      let low = 0, prev = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        low = 0.96 * low + 0.04 * white;
        const high = white - prev;
        prev = white;
        data[i] = (low * 1.4 + high * 0.14);
      }
    } else if (type === 'blue') {
      let prev = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (white - prev) * 0.28;
        prev = white;
      }
    } else if (type === 'violet') {
      let p1 = 0, p2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        const d1 = white - p1;
        const d2 = d1 - p2;
        p1 = white;
        p2 = d1;
        data[i] = d2 * 0.16;
      }
    }
    return buffer;
  }

  function stopBaseNoiseSources() {
    if (noiseNode) {
      try { noiseNode.stop(); noiseNode.disconnect(); } catch (e) {}
      noiseNode = null;
    }
    if (customNoiseMediaEl) {
      try { customNoiseMediaEl.pause(); customNoiseMediaEl.remove(); } catch (e) {}
      customNoiseMediaEl = null;
      customNoiseMediaSrc = null;
    }
    if (customNoiseYtController) {
      customNoiseYtController.destroy();
      customNoiseYtController = null;
    }
  }

  async function startBaseNoise() {
    ensureAudioContext();
    stopBaseNoiseSources();

    const customNoiseObj = (appState.customNoises || []).find(cn => cn.id === noiseType);

    if (customNoiseObj) {
      if (customNoiseObj.sourceType === 'local') {
        const blobUrl = await getLocalBlobUrlFromDB(customNoiseObj.id);
        if (blobUrl && isPlaying) {
          const el = document.createElement('audio');
          el.src = blobUrl;
          el.loop = true;
          hiddenMediaDock.appendChild(el);
          customNoiseMediaEl = el;
          customNoiseMediaSrc = audioCtx.createMediaElementSource(el);
          customNoiseMediaSrc.connect(hpCleanFilter);
          el.play().catch(() => {});
        }
      } else if (customNoiseObj.sourceType === 'youtube') {
        const effVol = masterVolume * volume * 100;
        customNoiseYtController = createManagedYouTubePlayer(
          customNoiseObj.youtubeId,
          effVol,
          (errCode) => {
            if (errCode === 101 || errCode === 150) {
              alert(`O dono do vídeo "${customNoiseObj.name}" bloqueou a reprodução fora do YouTube. Tente outro link do YouTube.`);
            }
          }
        );
      }
    } else {
      noiseNode = audioCtx.createBufferSource();
      noiseNode.buffer = createNoiseBuffer(audioCtx, noiseType);
      noiseNode.loop = true;
      noiseNode.connect(hpCleanFilter);
      noiseNode.start();
    }

    noiseGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
    noiseGainNode.gain.setTargetAtTime(Math.max(0.0001, volume), audioCtx.currentTime, 0.04);
  }

  async function startNatureSound(id) {
    ensureAudioContext();
    stopNatureSound(id);

    const st = appState.nature[id];
    if (!st || !st.enabled || !isPlaying) return;

    const customSoundObj = (appState.customSounds || []).find(cs => cs.id === id);

    if (customSoundObj) {
      if (customSoundObj.sourceType === 'local') {
        const blobUrl = await getLocalBlobUrlFromDB(id);
        if (!blobUrl || !isPlaying || !appState.nature[id]?.enabled) return;

        const el = document.createElement('audio');
        el.src = blobUrl;
        el.loop = true;
        hiddenMediaDock.appendChild(el);

        const gain = audioCtx.createGain();
        gain.gain.value = (st.volume / 100);
        gain.connect(masterCompressor);

        const toneFilter = audioCtx.createBiquadFilter();
        toneFilter.type = 'lowpass';
        toneFilter.frequency.value = 300 + (st.tone / 100) ** 2 * 19700;
        toneFilter.Q.value = 0.35;

        const srcNode = audioCtx.createMediaElementSource(el);
        srcNode.connect(toneFilter);
        toneFilter.connect(gain);
        el.play().catch(() => {});
        natureEngines[id] = { mediaEl: el, srcNode, toneFilter, gain };
      } else if (customSoundObj.sourceType === 'youtube') {
        const effVol = masterVolume * (st.volume / 100) * 100;
        const ytCtrl = createManagedYouTubePlayer(
          customSoundObj.youtubeId,
          effVol,
          (errCode) => {
            if (errCode === 101 || errCode === 150) {
              alert(`O dono do vídeo "${customSoundObj.name}" bloqueou a reprodução incorporada fora do YouTube. Tente outro link.`);
            }
          }
        );
        natureEngines[id] = { ytCtrl };
      }
      return;
    }

    const gain = audioCtx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(masterCompressor);

    const soundDef = getAllSoundDefs().find(def => def.id === id);
    const gainScale = soundDef && soundDef.isCustom
      ? 1
      : (soundDef && typeof soundDef.gainScale === 'number' ? soundDef.gainScale : 0.6);
    const volTarget = (st.volume / 100) * 0.65;
    const toneNorm = st.tone / 100;
    const createLoopingNoise = (color: string) => {
      const source = audioCtx.createBufferSource();
      source.buffer = createNoiseBuffer(audioCtx, color);
      source.loop = true;
      return source;
    };

    if (id === 'rain') {
      const src = audioCtx.createBufferSource();
      const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 3, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.03;
        b1 = 0.985 * b1 + w * 0.06;
        b2 = 0.950 * b2 + w * 0.09;
        const drop = Math.random() < 0.0018 ? (Math.random() * 2 - 1) * 0.65 : 0;
        d[i] = (b0 + b1 + b2 + drop) * 0.65;
      }
      src.buffer = buf;
      src.loop = true;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700 + toneNorm * 2400;
      filter.Q.value = 0.55;

      src.connect(filter);
      filter.connect(gain);
      src.start();
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.08);
      natureEngines[id] = { src, filter, gain };

    } else if (id === 'wind') {
      const src = audioCtx.createBufferSource();
      src.buffer = createNoiseBuffer(audioCtx, 'pink');
      src.loop = true;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 260 + toneNorm * 380;
      filter.Q.value = 2.4;

      const lfo = audioCtx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.08 + toneNorm * 0.25;

      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 140 + toneNorm * 220;

      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      src.connect(filter);
      filter.connect(gain);
      src.start();
      lfo.start();
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.1);
      natureEngines[id] = { src, filter, lfo, gain };

    } else if (id === 'waterfall') {
      const src = audioCtx.createBufferSource();
      const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 3, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.035 * w) / 1.035;
        d[i] = last * 2.1 + w * 0.08;
      }
      src.buffer = buf;
      src.loop = true;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 450 + toneNorm * 1600;

      src.connect(filter);
      filter.connect(gain);
      src.start();
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.08);
      natureEngines[id] = { src, filter, gain };

    } else if (id === 'birds') {
      const impulse = audioCtx.createBuffer(2, Math.floor(audioCtx.sampleRate * 1.25), audioCtx.sampleRate);
      for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
        const samples = impulse.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          const decay = (1 - i / samples.length) ** 2.8;
          samples[i] = (Math.random() * 2 - 1) * decay * 0.22;
        }
      }

      const reverb = audioCtx.createConvolver();
      reverb.buffer = impulse;
      const dry = audioCtx.createGain();
      dry.gain.value = 0.84;
      const wet = audioCtx.createGain();
      wet.gain.value = 0.16;
      dry.connect(gain);
      reverb.connect(wet);
      wet.connect(gain);
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.12);

      const chirp = () => {
        if (!isPlaying || !appState.nature[id]?.enabled) return;
        const now = audioCtx.currentTime + 0.03;
        const motif = Math.random();
        const notes = motif < 0.24 ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
        const panCenter = (Math.random() - 0.5) * 0.7;
        let t = now;

        for (let n = 0; n < notes; n++) {
          const osc = audioCtx.createOscillator();
          const env = audioCtx.createGain();
          const harmonic = audioCtx.createOscillator();
          const harmonicEnv = audioCtx.createGain();
          const pan = audioCtx.createStereoPanner();
          osc.type = 'sine';
          harmonic.type = 'sine';
          const baseFreq = 1900 + toneNorm * 1500 + Math.random() * 1300;
          const dur = 0.075 + Math.random() * 0.14;
          const rise = 1.07 + Math.random() * (motif < 0.24 ? 0.23 : 0.13);
          const fall = 0.9 + Math.random() * 0.09;
          const peak = baseFreq * rise;
          pan.pan.value = Math.max(-0.65, Math.min(0.65, panCenter + (Math.random() - 0.5) * 0.24));

          osc.frequency.setValueAtTime(baseFreq, t);
          osc.frequency.exponentialRampToValueAtTime(peak, t + dur * 0.42);
          osc.frequency.exponentialRampToValueAtTime(baseFreq * fall, t + dur);
          harmonic.frequency.setValueAtTime(baseFreq * 2.015, t);
          harmonic.frequency.exponentialRampToValueAtTime(peak * 2.01, t + dur * 0.42);
          harmonic.frequency.exponentialRampToValueAtTime(baseFreq * fall * 2, t + dur);

          env.gain.setValueAtTime(0.0001, t);
          env.gain.linearRampToValueAtTime(0.17 + Math.random() * 0.08, t + dur * 0.18);
          env.gain.setTargetAtTime(0.0001, t + dur * 0.28, dur * 0.22);
          env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          harmonicEnv.gain.setValueAtTime(0.0001, t);
          harmonicEnv.gain.linearRampToValueAtTime(0.035, t + dur * 0.2);
          harmonicEnv.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          osc.connect(env);
          env.connect(pan);
          harmonic.connect(harmonicEnv);
          harmonicEnv.connect(pan);
          pan.connect(dry);
          pan.connect(reverb);
          osc.start(t);
          harmonic.start(t);
          osc.stop(t + dur + 0.02);
          harmonic.stop(t + dur + 0.02);
          t += dur + (motif < 0.24 ? 0.025 + Math.random() * 0.03 : 0.07 + Math.random() * 0.1);
        }

        natureEngines[id].timer = setTimeout(chirp, 2600 + Math.random() * 5200 - toneNorm * 1000);
      };

      natureEngines[id] = { timer: null, gain, nodes: [reverb, dry, wet] };
      chirp();

    } else if (id === 'cicadas') {
      const carrier = audioCtx.createOscillator();
      carrier.type = 'triangle';
      carrier.frequency.value = 4200 + toneNorm * 1100;

      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 4500 + toneNorm * 1000;
      bp.Q.value = 3.5;

      const pulseGain = audioCtx.createGain();
      pulseGain.gain.value = 0.5;

      const pulseLfo = audioCtx.createOscillator();
      pulseLfo.type = 'sine';
      pulseLfo.frequency.value = 14 + toneNorm * 12;

      const pulseDepth = audioCtx.createGain();
      pulseDepth.gain.value = 0.45;

      const slowLfo = audioCtx.createOscillator();
      slowLfo.type = 'sine';
      slowLfo.frequency.value = 0.18;

      const slowDepth = audioCtx.createGain();
      slowDepth.gain.value = 0.12;

      pulseLfo.connect(pulseDepth);
      pulseDepth.connect(pulseGain.gain);

      carrier.connect(bp);
      bp.connect(pulseGain);
      pulseGain.connect(gain);

      slowLfo.connect(slowDepth);
      slowDepth.connect(gain.gain);

      carrier.start();
      pulseLfo.start();
      slowLfo.start();

      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.15);
      natureEngines[id] = { src: carrier, lfo: pulseLfo, slowLfo, filter: bp, gain };

    } else if (id === 'ocean') {
      const waves = createLoopingNoise('pink');
      const waveHighPass = audioCtx.createBiquadFilter();
      waveHighPass.type = 'highpass';
      waveHighPass.frequency.value = 45;
      const waveLowPass = audioCtx.createBiquadFilter();
      waveLowPass.type = 'lowpass';
      waveLowPass.frequency.value = 650 + toneNorm * 1500;
      const swell = audioCtx.createGain();
      swell.gain.value = 0.58;

      const foam = createLoopingNoise('pink');
      const foamFilter = audioCtx.createBiquadFilter();
      foamFilter.type = 'bandpass';
      foamFilter.frequency.value = 1500 + toneNorm * 2500;
      foamFilter.Q.value = 0.65;
      const foamGain = audioCtx.createGain();
      foamGain.gain.value = 0.14;

      const swellLfo = audioCtx.createOscillator();
      swellLfo.type = 'sine';
      swellLfo.frequency.value = 0.045 + toneNorm * 0.035;
      const swellDepth = audioCtx.createGain();
      swellDepth.gain.value = 0.28;
      const foamDepth = audioCtx.createGain();
      foamDepth.gain.value = 0.08;
      swellLfo.connect(swellDepth);
      swellDepth.connect(swell.gain);
      swellLfo.connect(foamDepth);
      foamDepth.connect(foamGain.gain);

      waves.connect(waveHighPass);
      waveHighPass.connect(waveLowPass);
      waveLowPass.connect(swell);
      swell.connect(gain);
      foam.connect(foamFilter);
      foamFilter.connect(foamGain);
      foamGain.connect(gain);
      waves.start();
      foam.start();
      swellLfo.start();
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.15);
      natureEngines[id] = {
        sources: [waves, foam],
        oscillators: [swellLfo],
        nodes: [waveHighPass, waveLowPass, swell, foamFilter, foamGain, swellDepth, foamDepth],
        gain
      };

    } else if (id === 'stream') {
      const water = createLoopingNoise('pink');
      const highPass = audioCtx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 170;
      const streamFilter = audioCtx.createBiquadFilter();
      streamFilter.type = 'bandpass';
      streamFilter.frequency.value = 900 + toneNorm * 1600;
      streamFilter.Q.value = 0.48;
      const lowLayer = createLoopingNoise('brown');
      const lowPass = audioCtx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 260;
      const lowGain = audioCtx.createGain();
      lowGain.gain.value = 0.18;

      const currentLfo = audioCtx.createOscillator();
      currentLfo.type = 'sine';
      currentLfo.frequency.value = 0.12 + toneNorm * 0.12;
      const currentDepth = audioCtx.createGain();
      currentDepth.gain.value = 240;
      currentLfo.connect(currentDepth);
      currentDepth.connect(streamFilter.frequency);

      water.connect(highPass);
      highPass.connect(streamFilter);
      streamFilter.connect(gain);
      lowLayer.connect(lowPass);
      lowPass.connect(lowGain);
      lowGain.connect(gain);
      water.start();
      lowLayer.start();
      currentLfo.start();
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.12);
      natureEngines[id] = {
        sources: [water, lowLayer],
        oscillators: [currentLfo],
        nodes: [highPass, streamFilter, lowPass, lowGain, currentDepth],
        gain
      };

    } else if (id === 'fireplace') {
      const fire = createLoopingNoise('brown');
      const warmth = audioCtx.createBiquadFilter();
      warmth.type = 'lowpass';
      warmth.frequency.value = 380 + toneNorm * 900;
      const emberBed = audioCtx.createGain();
      emberBed.gain.value = 0.52;
      const fireLfo = audioCtx.createOscillator();
      fireLfo.type = 'sine';
      fireLfo.frequency.value = 0.09 + Math.random() * 0.06;
      const fireDepth = audioCtx.createGain();
      fireDepth.gain.value = 0.12;
      fireLfo.connect(fireDepth);
      fireDepth.connect(emberBed.gain);
      fire.connect(warmth);
      warmth.connect(emberBed);
      emberBed.connect(gain);
      fire.start();
      fireLfo.start();
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.2);

      const makePop = () => {
        if (!isPlaying || !appState.nature[id]?.enabled) return;
        const now = audioCtx.currentTime;
        const duration = 0.035 + Math.random() * 0.055;
        const pop = audioCtx.createBufferSource();
        const popBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * duration), audioCtx.sampleRate);
        const popSamples = popBuffer.getChannelData(0);
        for (let i = 0; i < popSamples.length; i++) {
          popSamples[i] = (Math.random() * 2 - 1) * (1 - i / popSamples.length);
        }
        pop.buffer = popBuffer;
        const popFilter = audioCtx.createBiquadFilter();
        popFilter.type = 'bandpass';
        popFilter.frequency.value = 800 + Math.random() * (1500 + toneNorm * 2500);
        popFilter.Q.value = 0.75 + Math.random() * 1.1;
        const popEnvelope = audioCtx.createGain();
        popEnvelope.gain.setValueAtTime(0.0001, now);
        popEnvelope.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.2, now + 0.004);
        popEnvelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        pop.connect(popFilter);
        popFilter.connect(popEnvelope);
        popEnvelope.connect(gain);
        pop.start(now);
        pop.stop(now + duration + 0.01);
        natureEngines[id].timer = setTimeout(makePop, 450 + Math.random() * 1500 - toneNorm * 250);
      };

      natureEngines[id] = {
        timer: null,
        src: fire,
        lfo: fireLfo,
        nodes: [warmth, emberBed, fireDepth],
        gain
      };
      makePop();

    } else if (id === 'thunder') {
      const engine = { timer: null, sources: [], gain };
      const makeRoll = () => {
        if (!isPlaying || !appState.nature[id]?.enabled) return;
        const now = audioCtx.currentTime;
        const duration = 3.5 + Math.random() * 4.5;
        const attack = 0.18 + Math.random() * 0.55;

        const rumble = createLoopingNoise('brown');
        const rumbleFilter = audioCtx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 65 + toneNorm * 150;
        rumbleFilter.Q.value = 0.55;
        const rumbleEnvelope = audioCtx.createGain();
        rumbleEnvelope.gain.setValueAtTime(0.0001, now);
        rumbleEnvelope.gain.linearRampToValueAtTime(0.52, now + attack);
        rumbleEnvelope.gain.setTargetAtTime(0.0001, now + attack, duration / 3);
        rumble.connect(rumbleFilter);
        rumbleFilter.connect(rumbleEnvelope);
        rumbleEnvelope.connect(gain);
        rumble.start(now);
        rumble.stop(now + duration);

        const sub = audioCtx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(43 + toneNorm * 16, now);
        sub.frequency.exponentialRampToValueAtTime(28 + toneNorm * 12, now + duration);
        const subEnvelope = audioCtx.createGain();
        subEnvelope.gain.setValueAtTime(0.0001, now);
        subEnvelope.gain.linearRampToValueAtTime(0.18, now + attack);
        subEnvelope.gain.setTargetAtTime(0.0001, now + attack, duration / 3);
        sub.connect(subEnvelope);
        subEnvelope.connect(gain);
        sub.start(now);
        sub.stop(now + duration);

        engine.sources.push(rumble, sub);
        rumble.onended = () => { engine.sources = engine.sources.filter(source => source !== rumble); };
        sub.onended = () => { engine.sources = engine.sources.filter(source => source !== sub); };
        engine.timer = setTimeout(makeRoll, 10000 + Math.random() * 19000);
      };

      natureEngines[id] = engine;
      gain.gain.setTargetAtTime(volTarget * gainScale, audioCtx.currentTime, 0.2);
      engine.timer = setTimeout(makeRoll, 2500 + Math.random() * 5500);
    }
  }

  function stopNatureSound(id) {
    const eng = natureEngines[id];
    if (!eng) return;
    if (eng.timer) clearTimeout(eng.timer);
    if (eng.mediaEl) {
      try { eng.mediaEl.pause(); eng.mediaEl.remove(); } catch (e) {}
    }
    if (eng.ytCtrl) {
      eng.ytCtrl.destroy();
    }
    if (eng.gain && audioCtx) {
      try {
        eng.gain.gain.cancelScheduledValues(audioCtx.currentTime);
        eng.gain.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.03);
      } catch (e) {}
    }
    const sources = (eng.sources || []).concat(
      eng.src ? [eng.src] : [],
      eng.src2 ? [eng.src2] : [],
      eng.oscillators || [],
      eng.lfo ? [eng.lfo] : [],
      eng.lfo2 ? [eng.lfo2] : [],
      eng.slowLfo ? [eng.slowLfo] : []
    );
    const nodes = (eng.nodes || []).concat(
      eng.filter ? [eng.filter] : [],
      eng.srcNode ? [eng.srcNode] : [],
      eng.toneFilter ? [eng.toneFilter] : []
    );
    setTimeout(() => {
      sources.forEach(source => { try { source.stop(); } catch (e) {} });
      nodes.forEach(node => { try { node.disconnect(); } catch (e) {} });
      try { if (eng.gain) eng.gain.disconnect(); } catch (e) {}
    }, 90);
    delete natureEngines[id];
  }

  function syncAllNatureSounds() {
    getAllSoundDefs().forEach(def => {
      if (!appState.nature[def.id]) {
        appState.nature[def.id] = { enabled: false, volume: def.defaultVol, tone: def.defaultTone };
      }
      if (isPlaying && appState.nature[def.id].enabled) {
        startNatureSound(def.id);
      } else {
        stopNatureSound(def.id);
      }
    });
  }

  function updateAllYouTubeVolumes() {
    if (customNoiseYtController) {
      customNoiseYtController.setVolume(masterVolume * volume * 100);
    }
    Object.keys(natureEngines).forEach(id => {
      const eng = natureEngines[id];
      if (eng && eng.ytCtrl && appState.nature[id]) {
        eng.ytCtrl.setVolume(masterVolume * (appState.nature[id].volume / 100) * 100);
      }
    });
  }

  const appShell = document.getElementById('appShell');
  const panelsWorkspace = document.getElementById('panelsWorkspace');
  const splitDropZone = document.getElementById('splitDropZone');

  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const playText = document.getElementById('playText');
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');

  const activeProfileTag = document.getElementById('activeProfileTag');
  const activeTagSwatch = document.getElementById('activeTagSwatch');
  const activeTagName = document.getElementById('activeTagName');

  const masterVolSlider = document.getElementById('masterVolSlider') as HTMLInputElement;
  const masterVolInput = document.getElementById('masterVolInput') as HTMLInputElement;

  const volSlider = document.getElementById('volSlider') as HTMLInputElement;
  const volInput = document.getElementById('volInput') as HTMLInputElement;

  const freqSlider = document.getElementById('freqSlider') as HTMLInputElement;
  const freqInput = document.getElementById('freqInput') as HTMLInputElement;

  const polishSlider = document.getElementById('polishSlider') as HTMLInputElement;
  const polishInput = document.getElementById('polishInput') as HTMLInputElement;
  const polishModeHint = document.getElementById('polishModeHint');

  const customMinInput = document.getElementById('customMinInput') as HTMLInputElement;
  const setCustomTimerBtn = document.getElementById('setCustomTimerBtn');
  const timerLabelText = document.getElementById('timerLabelText');
  const timerDisplay = document.getElementById('timerDisplay');

  const expandNoiseBtn = document.getElementById('expandNoiseBtn');
  const extraNoiseDrawer = document.getElementById('extraNoiseDrawer');
  const customNoisesSlot = document.getElementById('customNoisesSlot');
  const natureList = document.getElementById('natureList');
  const natureActiveCount = document.getElementById('natureActiveCount');

  const pipBtn = document.getElementById('pipBtn');
  const pipLabel = document.getElementById('pipLabel');
  const lockBtn = document.getElementById('lockBtn');
  const lockLabel = document.getElementById('lockLabel');
  const splitDropLabel = document.getElementById('splitDropLabel');
  const downloadYtBtn = document.getElementById('downloadYtBtn');
  const openDownloadsBtn = document.getElementById('openDownloadsBtn');
  const installYtDlpBtn = document.getElementById('installYtDlpBtn');
  const downloadStatusEl = document.getElementById('downloadStatus');

  const profilesList = document.getElementById('profilesList');
  const addProfileBtn = document.getElementById('addProfileBtn');
  const sidebarGearBtn = document.getElementById('sidebarGearBtn');

  const cfgAutoPlay = document.getElementById('cfgAutoPlay') as HTMLInputElement;
  const cfgAutoPip = document.getElementById('cfgAutoPip') as HTMLInputElement;
  const cfgStartCompact = document.getElementById('cfgStartCompact') as HTMLInputElement;
  const cfgRunInBackground = document.getElementById('cfgRunInBackground') as HTMLInputElement;
  const cfgScrollStep = document.getElementById('cfgScrollStep') as HTMLInputElement;
  const resetCacheBtn = document.getElementById('resetCacheBtn');

  const profileModal = document.getElementById('profileModal');
  const newProfileName = document.getElementById('newProfileName') as HTMLInputElement;
  const profileIconPalette = document.getElementById('profileIconPalette');
  const colorPalette = document.getElementById('colorPalette');
  const modalConfigSummary = document.getElementById('modalConfigSummary');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const saveProfileBtn = document.getElementById('saveProfileBtn');

  const mediaModal = document.getElementById('mediaModal');
  const mediaModalTitle = document.getElementById('mediaModalTitle');
  const mediaModalSub = document.getElementById('mediaModalSub');
  const srcTabYoutube = document.getElementById('srcTabYoutube');
  const srcTabLocal = document.getElementById('srcTabLocal');
  const mediaNameInput = document.getElementById('mediaNameInput') as HTMLInputElement;
  const youtubeFieldGroup = document.getElementById('youtubeFieldGroup');
  const mediaYoutubeInput = document.getElementById('mediaYoutubeInput') as HTMLInputElement;
  const localFieldGroup = document.getElementById('localFieldGroup');
  const localFileDrop = document.getElementById('localFileDrop');
  const localFileInput = document.getElementById('localFileInput') as HTMLInputElement;
  const cancelMediaBtn = document.getElementById('cancelMediaBtn');
  const saveMediaBtn = document.getElementById('saveMediaBtn');

  const canvas = document.getElementById('spectrum') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const eqCurveCanvas = document.getElementById('eqCurve') as HTMLCanvasElement;
  const eqCurveCtx = eqCurveCanvas ? eqCurveCanvas.getContext('2d') : null;
  const eqBandsEl = document.getElementById('eqBands');
  const eqPresetsEl = document.getElementById('eqPresets');
  const microMasterVol = document.getElementById('microMasterVol') as HTMLInputElement;
  const microMasterVolTxt = document.getElementById('microMasterVolTxt');
  const microExpandBtn = document.getElementById('microExpandBtn');
  let selectedModalColor = GOOGLE_COLORS[0];
  let selectedModalIcon = PROFILE_ICONS[0];
  const miniPlaybackLabel = document.getElementById('miniPlaybackLabel');

  let lockedControlRecords = [];

  // Permitido quando bloqueado: navegação (abas, perfis, split), play/pause,
  // volume GERAL (master/micro), abinha flutuante e abrir pasta de downloads.
  // Tudo que altera parâmetros numéricos (volume por som, EQ, corte, polish,
  // timer), configurações ou CRUD é desabilitado.
  function isNavigationOrPlaybackControl(el) {
    if (!el) return false;
    if (el === lockBtn || lockBtn.contains(el)) return true;
    if (el === playBtn || el === pipBtn || el === microExpandBtn) return true;
    if (el.closest('.nav-tabs-wrap, .profiles-sidebar, .split-panel-banner')) return true;
    if (el === openDownloadsBtn) return true;
    // Volume geral apenas (slider/input da aba e o slider do modo compacto)
    if (el.id === 'masterVolSlider' || el.id === 'masterVolInput' || el.id === 'microMasterVol') return true;
    return false;
  }

  function applyUiLock() {
    const locked = !!appState.settings.uiLocked;
    document.body.classList.toggle('ui-locked', locked);
    if (lockBtn) {
      lockBtn.innerHTML = locked ? '🔒 <span id="lockLabel">Bloqueado</span>' : '🔓 <span id="lockLabel">Editar</span>';
      lockBtn.title = locked ? 'Desbloquear edição' : 'Bloquear edição';
    }

    lockedControlRecords.forEach(rec => {
      if (!rec.el.isConnected) return;
      if (rec.disabled !== undefined) rec.el.disabled = rec.disabled;
      if (rec.draggable !== undefined) rec.el.setAttribute('draggable', rec.draggable);
    });
    lockedControlRecords = [];
    if (!locked) return;

    document.querySelectorAll<HTMLElement>('input, select, textarea, button, [draggable="true"]').forEach(el => {
      if (isNavigationOrPlaybackControl(el) || lockBtn.contains(el)) return;
      const rec = { el, disabled: undefined, draggable: undefined };
      if ('disabled' in el) {
        rec.disabled = el.disabled;
        el.disabled = true;
      }
      if (el.hasAttribute('draggable')) {
        rec.draggable = el.getAttribute('draggable');
        el.setAttribute('draggable', 'false');
      }
      if (rec.disabled !== undefined || rec.draggable !== undefined) lockedControlRecords.push(rec);
    });
  }

  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      appState.settings.uiLocked = !appState.settings.uiLocked;
      applyUiLock();
      saveCache(true);
    });
  }

  let primaryTabId = 'noiseTab';
  const splitTabIds = [];
  let draggedTabId = null;
  const MAX_SPLIT_TABS = 2;

  function renderTabsAndPanels(shouldResize = true) {
    document.querySelectorAll<HTMLElement>('.nav-tab').forEach(btn => {
      const tid = btn.dataset.tab;
      btn.classList.toggle('active', tid === primaryTabId);
      btn.classList.toggle('split-secondary', splitTabIds.indexOf(tid) >= 0);
    });

    document.querySelectorAll<HTMLElement>('.tab-panel').forEach(panel => {
      const pid = panel.id;
      panel.classList.toggle('active', pid === primaryTabId);
      panel.classList.toggle('split-slot-1', splitTabIds[0] === pid);
      panel.classList.toggle('split-slot-2', splitTabIds[1] === pid);
    });

    const count = splitTabIds.length;
    panelsWorkspace.classList.toggle('has-split-1', count >= 1);
    panelsWorkspace.classList.toggle('has-split-2', count >= 2);
    appShell.classList.toggle('split-mode', count > 0);
    appShell.classList.toggle('split-mode-2', count >= 2);
    sidebarGearBtn.classList.toggle('active', primaryTabId === 'settingsTab' || splitTabIds.indexOf('settingsTab') >= 0);
    if (splitDropLabel) {
      splitDropLabel.textContent = 'Solte aqui para abrir lado a lado (' +
        Math.min(count + 1, MAX_SPLIT_TABS) + '/' + MAX_SPLIT_TABS + ')';
    }

    if (shouldResize && !document.body.classList.contains('mini-mode')) {
      if (count >= 2) {
        const targetW = Math.min(1480, Math.max(900, (window.screen && window.screen.availWidth || 1600) - 60));
        try { window.resizeTo(targetW, 790); } catch (e) {}
      } else if (count === 1) {
        try { window.resizeTo(1040, 790); } catch (e) {}
      } else {
        try { window.resizeTo(610, 780); } catch (e) {}
      }
    }
    queueWindowBoundsSave();
  }

  function switchToTab(tabId) {
    const idx = splitTabIds.indexOf(tabId);
    if (idx >= 0) splitTabIds[idx] = primaryTabId;
    primaryTabId = tabId;
    renderTabsAndPanels();
  }

  function openSplitTab(tabId) {
    if (!tabId || tabId === primaryTabId) return;
    const idx = splitTabIds.indexOf(tabId);
    if (idx >= 0) splitTabIds.splice(idx, 1);
    if (splitTabIds.length >= MAX_SPLIT_TABS) splitTabIds.pop();
    splitTabIds.push(tabId);
    renderTabsAndPanels();
  }

  function closeSplitTab(tabId) {
    if (tabId) {
      const idx = splitTabIds.indexOf(tabId);
      if (idx < 0) return;
      splitTabIds.splice(idx, 1);
    } else {
      splitTabIds.length = 0;
    }
    renderTabsAndPanels();
  }

  document.querySelectorAll<HTMLElement>('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchToTab(tab.dataset.tab));

    tab.addEventListener('dragstart', (e: any) => {
      draggedTabId = tab.dataset.tab;
      e.dataTransfer.setData('text/plain', draggedTabId);
      e.dataTransfer.effectAllowed = 'move';
      if (draggedTabId !== primaryTabId) {
        splitDropZone.classList.add('visible');
      }
    });

    tab.addEventListener('dragend', () => {
      splitDropZone.classList.remove('visible', 'drag-over');
      draggedTabId = null;
    });
  });

  splitDropZone.addEventListener('dragover', (e: any) => {
    e.preventDefault();
    splitDropZone.classList.add('drag-over');
  });

  splitDropZone.addEventListener('dragleave', () => {
    splitDropZone.classList.remove('drag-over');
  });

  splitDropZone.addEventListener('drop', (e: any) => {
    e.preventDefault();
    const tid = e.dataTransfer.getData('text/plain') || draggedTabId;
    splitDropZone.classList.remove('visible', 'drag-over');
    if (tid && tid !== primaryTabId) {
      openSplitTab(tid);
    }
  });

  panelsWorkspace.addEventListener('dragover', (e: any) => {
    if (draggedTabId && draggedTabId !== primaryTabId) {
      e.preventDefault();
      splitDropZone.classList.add('visible');
    }
  });

  document.querySelectorAll<HTMLElement>('.close-split-btn').forEach(btn => {
    btn.addEventListener('click', () => closeSplitTab(btn.dataset.closeSplit));
  });

  sidebarGearBtn.addEventListener('click', () => {
    const isSettingsOpen = primaryTabId === 'settingsTab' || splitTabIds.indexOf('settingsTab') >= 0;
    if (splitTabIds.indexOf('settingsTab') >= 0) closeSplitTab('settingsTab');
    else switchToTab(isSettingsOpen ? 'noiseTab' : 'settingsTab');
  });

  expandNoiseBtn.addEventListener('click', () => {
    const isOpen = extraNoiseDrawer.classList.toggle('open');
    expandNoiseBtn.textContent = isOpen ? 'Menos opções ▴' : 'Mais opções ▾';
  });

  let mediaTargetCategory = 'sound';
  let mediaSourceMode = 'youtube';
  let pendingLocalFile = null;
  let editingMediaId = null;

  function setMediaSourceMode(mode) {
    mediaSourceMode = mode;
    srcTabYoutube.classList.toggle('active', mode === 'youtube');
    srcTabLocal.classList.toggle('active', mode === 'local');
    youtubeFieldGroup.style.display = mode === 'youtube' ? 'flex' : 'none';
    localFieldGroup.style.display = mode === 'local' ? 'flex' : 'none';
  }

  function closeMediaModal() {
    mediaModal.classList.remove('open');
    editingMediaId = null;
    pendingLocalFile = null;
    saveMediaBtn.textContent = 'Adicionar';
  }

  function openAddMediaModal(category, item = null) {
    mediaTargetCategory = category;
    editingMediaId = item ? item.id : null;
    pendingLocalFile = null;

    mediaModalTitle.textContent = editingMediaId
      ? (category === 'noise' ? 'Editar ruído base' : 'Editar som')
      : (category === 'noise' ? 'Adicionar novo ruído base' : 'Adicionar novo som');
    mediaModalSub.textContent = editingMediaId
      ? 'Altere o nome ou a origem. Volume e tom serão mantidos.'
      : 'Cole um link do YouTube ou escolha um arquivo do computador';

    mediaNameInput.value = item ? item.name : '';
    mediaYoutubeInput.value = item && item.sourceType === 'youtube'
      ? `https://www.youtube.com/watch?v=${item.youtubeId}`
      : '';
    localFileInput.value = '';
    localFileDrop.textContent = item && item.sourceType === 'local'
      ? `Arquivo atual: ${item.fileName || 'áudio local'} (selecione outro para substituir)`
      : 'Clique aqui para escolher um arquivo do seu computador';

    setMediaSourceMode(item && item.sourceType === 'local' ? 'local' : 'youtube');
    saveMediaBtn.textContent = editingMediaId ? 'Salvar alterações' : 'Adicionar';

    mediaModal.classList.add('open');
    setTimeout(() => mediaNameInput.focus(), 40);
    refreshDownloadStatus();
  }

  function showDownloadStatus(text, state) {
    if (!downloadStatusEl) return;
    downloadStatusEl.textContent = text || '';
    downloadStatusEl.className = 'download-status' + (state ? ' ' + state : '');
  }

  async function refreshDownloadStatus() {
    if (!downloadStatusEl) return;
    try {
      const res = await fetch('/download-status', { cache: 'no-store' });
      const data = await res.json();
      showDownloadStatus(data.message || '', data.state || 'idle');
      if (data.state === 'downloading') {
        clearTimeout(window._downloadPollTimer);
        window._downloadPollTimer = setTimeout(refreshDownloadStatus, 1200);
      }
    } catch (e) {
      showDownloadStatus('', 'idle');
    }
  }

  if (downloadYtBtn) {
    downloadYtBtn.addEventListener('click', async () => {
      const raw = mediaYoutubeInput.value.trim();
      if (!raw) {
        showDownloadStatus('Cole uma URL do YouTube no campo acima.', 'error');
        return;
      }
      if (!extractYouTubeId(raw)) {
        showDownloadStatus('Link do YouTube inválido.', 'error');
        return;
      }
      showDownloadStatus('Iniciando download...', 'downloading');
      try {
        const res = await fetch('/download-youtube?url=' + encodeURIComponent(raw), { cache: 'no-store' });
        const msg = (await res.text()).trim();
        if (!res.ok || msg) showDownloadStatus(msg || 'Falha ao iniciar o download.', 'error');
        else refreshDownloadStatus();
      } catch (e) {
        showDownloadStatus('Não foi possível falar com o servidor local.', 'error');
      }
    });
  }

  if (openDownloadsBtn) {
    openDownloadsBtn.addEventListener('click', () => {
      fetch('/open-downloads', { cache: 'no-store' }).catch(() => {});
    });
  }

  if (installYtDlpBtn) {
    installYtDlpBtn.addEventListener('click', async () => {
      showDownloadStatus('Instalando yt-dlp...', 'downloading');
      try {
        const res = await fetch('/install-ytdlp', { cache: 'no-store' });
        const msg = (await res.text()).trim();
        if (!res.ok || msg) showDownloadStatus(msg || 'Falha ao instalar o yt-dlp.', 'error');
        else refreshDownloadStatus();
      } catch (e) {
        showDownloadStatus('Não foi possível falar com o servidor local.', 'error');
      }
    });
  }

  document.getElementById('openAddNoiseMediaBtn').addEventListener('click', () => openAddMediaModal('noise'));
  document.getElementById('openAddSoundMediaBtn').addEventListener('click', () => openAddMediaModal('sound'));
  cancelMediaBtn.addEventListener('click', closeMediaModal);
  mediaModal.addEventListener('click', (e: any) => { if (e.target === mediaModal) closeMediaModal(); });

  srcTabYoutube.addEventListener('click', () => {
    setMediaSourceMode('youtube');
  });

  srcTabLocal.addEventListener('click', () => {
    setMediaSourceMode('local');
  });

  localFileDrop.addEventListener('click', () => localFileInput.click());
  localFileInput.addEventListener('change', (e: any) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      pendingLocalFile = file;
      localFileDrop.textContent = `✓ Selecionado: ${file.name}`;
      if (!mediaNameInput.value.trim()) {
        mediaNameInput.value = file.name.replace(/\.[^/.]+$/, '').slice(0, 28);
      }
    }
  });

  saveMediaBtn.addEventListener('click', async () => {
    const collection = mediaTargetCategory === 'noise' ? appState.customNoises : appState.customSounds;
    const existing = editingMediaId ? collection.find(item => item.id === editingMediaId) : null;
    if (editingMediaId && !existing) {
      alert('Este áudio não está mais disponível. Atualize a lista e tente novamente.');
      closeMediaModal();
      return;
    }

    let itemName = mediaNameInput.value.trim();
    const itemId = existing ? existing.id : (mediaTargetCategory === 'noise' ? 'cnoise_' : 'csound_') + Date.now();
    let youtubeId = null;
    if (mediaSourceMode === 'youtube') {
      youtubeId = extractYouTubeId(mediaYoutubeInput.value);
      if (!youtubeId) {
        alert('Por favor, insira um link válido do YouTube (ex: https://www.youtube.com/watch?v=...)');
        return;
      }
      if (!itemName) itemName = existing ? existing.name : `YouTube (${youtubeId.slice(0, 6)})`;
    } else {
      if (!pendingLocalFile && (!existing || existing.sourceType !== 'local')) {
        alert('Escolha um arquivo de áudio ou vídeo do seu computador primeiro.');
        return;
      }
      if (!itemName) {
        itemName = existing
          ? existing.name
          : pendingLocalFile.name.replace(/\.[^/.]+$/, '').slice(0, 28);
      }
    }

    const sourceChanged = !!existing && (
      existing.sourceType !== mediaSourceMode ||
      (mediaSourceMode === 'youtube' && existing.youtubeId !== youtubeId) ||
      (mediaSourceMode === 'local' && !!pendingLocalFile)
    );
    if (sourceChanged) {
      if (mediaTargetCategory === 'sound') stopNatureSound(itemId);
      else if (noiseType === itemId) stopBaseNoiseSources();
    }

    if (mediaSourceMode === 'local' && pendingLocalFile) {
      if (!await saveLocalBlobToDB(itemId, pendingLocalFile)) {
        alert('Não foi possível salvar o arquivo de áudio neste navegador. Verifique o espaço disponível e tente novamente.');
        if (sourceChanged && mediaTargetCategory === 'sound' && isPlaying && appState.nature[itemId]?.enabled) {
          startNatureSound(itemId);
        } else if (sourceChanged && mediaTargetCategory === 'noise' && noiseType === itemId && isPlaying) {
          startBaseNoise();
        }
        return;
      }
    }

    if (mediaSourceMode === 'youtube' && existing && existing.sourceType === 'local') {
      await deleteLocalBlobFromDB(itemId);
    }

    const entry = mediaSourceMode === 'youtube'
      ? { id: itemId, name: itemName, sourceType: 'youtube', youtubeId }
      : {
          id: itemId,
          name: itemName,
          sourceType: 'local',
          fileName: pendingLocalFile ? pendingLocalFile.name : existing.fileName
        };
    if (existing) Object.assign(existing, entry);
    else collection.push(entry);

    if (existing && mediaSourceMode === 'local') delete existing.youtubeId;
    if (existing && mediaSourceMode === 'youtube') delete existing.fileName;

    if (!existing && mediaTargetCategory === 'noise') {
      renderCustomNoiseChips();
      setNoiseType(itemId, true);
      if (!isPlaying) startPlayback();
    } else if (!existing) {
      appState.nature[itemId] = { enabled: true, volume: 50, tone: 50 };
      renderNatureCards();
      syncUIState();
      if (!isPlaying) startPlayback();
      else startNatureSound(itemId);
    } else if (mediaTargetCategory === 'noise') {
      renderCustomNoiseChips();
      if (sourceChanged && noiseType === itemId && isPlaying) startBaseNoise();
    } else {
      renderNatureCards();
      syncUIState();
      if (sourceChanged && isPlaying && appState.nature[itemId]?.enabled) startNatureSound(itemId);
    }

    saveCache();
    closeMediaModal();
  });

  function renderCustomNoiseChips() {
    customNoisesSlot.innerHTML = '';
    (appState.customNoises || []).forEach(cn => {
      const chip = document.createElement('div');
      chip.className = 'g-chip' + (noiseType === cn.id ? ' selected' : '');
      chip.dataset.type = cn.id;
      chip.innerHTML = `
        <button class="chip-edit-btn" title="Editar ruído" aria-label="Editar ruído">✎</button>
        <button class="chip-del-btn" title="Remover ruído">×</button>
        <div class="chip-title">${cn.name}</div>
        <div class="chip-sub">${cn.sourceType === 'youtube' ? '▶️ YouTube' : '🎵 Arquivo Local'}</div>
      `;
      chip.querySelector('.chip-edit-btn').addEventListener('click', (e: any) => {
        e.stopPropagation();
        openAddMediaModal('noise', cn);
      });
      chip.querySelector('.chip-del-btn').addEventListener('click', (e: any) => {
        e.stopPropagation();
        appState.customNoises = appState.customNoises.filter(x => x.id !== cn.id);
        if (cn.sourceType === 'local') deleteLocalBlobFromDB(cn.id);
        renderCustomNoiseChips();
        if (noiseType === cn.id) setNoiseType('brown', true);
        saveCache();
      });
      chip.addEventListener('click', () => setNoiseType(cn.id, true));
      customNoisesSlot.appendChild(chip);
    });
  }

  function attachWheelControl(element, getCurrentValue, setNewValue, stepMultiplier = 1) {
    if (!element) return;
    element.addEventListener('click', () => element.classList.add('focused'));
    element.addEventListener('blur', () => element.classList.remove('focused'));
    element.addEventListener('wheel', (e: any) => {
      if (appState.settings.uiLocked && element.id !== 'masterVolControl') return;
      e.preventDefault();
      e.stopPropagation();
      const baseStep = appState.settings.scrollStep || 2;
      const step = Math.max(1, Math.round(baseStep * stepMultiplier));
      const delta = e.deltaY < 0 ? step : -step;
      setNewValue(getCurrentValue() + delta);
    }, { passive: false });
  }

  function setEqBand(index, rawDb) {
    const db = Math.max(-12, Math.min(12, Math.round(parseFloat(rawDb) || 0)));
    appState.eqGains[index] = db;
    const slider = document.getElementById('eqBandSlider_' + index) as HTMLInputElement;
    const readout = document.getElementById('eqBandValue_' + index);
    if (slider) slider.value = String(db);
    if (readout) readout.textContent = (db > 0 ? '+' : '') + db + ' dB';
    applyEqGains();
    updateEqPresetButtons();
    saveCache();
  }

  function updateEqPresetButtons() {
    if (!eqPresetsEl) return;
    Array.prototype.forEach.call(eqPresetsEl.querySelectorAll<HTMLElement>('.eq-preset-btn'), btn => {
      const preset = EQ_PRESETS[btn.dataset.preset];
      const match = preset && preset.every((v, i) => v === appState.eqGains[i]);
      btn.classList.toggle('active', !!match);
    });
  }

  function renderEqUI() {
    if (!eqBandsEl) return;
    eqBandsEl.innerHTML = '';
    EQ_BANDS.forEach((band, i) => {
      const row = document.createElement('div');
      row.className = 'eq-band';
      const label = document.createElement('span');
      label.className = 'eq-band-label';
      label.textContent = band.label + ' · ' + (band.freq >= 1000 ? (band.freq / 1000) + 'k' : band.freq) + 'Hz';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-12';
      slider.max = '12';
      slider.step = '1';
      slider.id = 'eqBandSlider_' + i;
      slider.value = String(appState.eqGains[i]);
      slider.addEventListener('input', (e: any) => setEqBand(i, e.target.value));
      attachWheelControl(slider, () => appState.eqGains[i], v => setEqBand(i, v), 1);
      const value = document.createElement('span');
      value.className = 'eq-band-value';
      value.id = 'eqBandValue_' + i;
      value.textContent = (appState.eqGains[i] > 0 ? '+' : '') + appState.eqGains[i] + ' dB';
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(value);
      eqBandsEl.appendChild(row);
    });

    if (eqPresetsEl) {
      eqPresetsEl.innerHTML = '';
      Object.keys(EQ_PRESETS).forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'eq-preset-btn';
        btn.type = 'button';
        btn.dataset.preset = name;
        btn.textContent = name;
        btn.addEventListener('click', () => {
          appState.eqGains = EQ_PRESETS[name].slice();
          renderEqUI();
          applyEqGains();
          saveCache();
        });
        eqPresetsEl.appendChild(btn);
      });
      updateEqPresetButtons();
    }
    drawEqCurve();
  }

  function syncUIState() {
    if (isPlaying) {
      playBtn.classList.add('playing');
      playIcon.textContent = '⏸';
      playText.textContent = 'Pausar áudio';
      statusPill.classList.add('playing');
      statusText.textContent = 'Reproduzindo';
    } else {
      playBtn.classList.remove('playing');
      playIcon.textContent = '▶';
      playText.textContent = 'Iniciar áudio';
      statusPill.classList.remove('playing');
      statusText.textContent = 'Pausado';
    }
    if (miniPlaybackLabel) miniPlaybackLabel.textContent = isPlaying ? 'Reproduzindo agora' : 'Reprodução pausada';

    const activeProf = appState.profiles.find(p => p.id === appState.activeProfileId);
    if (activeProf) {
      activeProfileTag.classList.add('visible');
      activeTagSwatch.style.background = activeProf.color;
      activeTagName.textContent = activeProf.name;
    } else {
      activeProfileTag.classList.remove('visible');
    }

    const enabledCount = getAllSoundDefs().filter(d => appState.nature[d.id]?.enabled).length;
    natureActiveCount.textContent = String(enabledCount);

    if (pipWindowRef && !pipWindowRef.closed) {
      const pBtn = pipWindowRef.document.getElementById('pipPlayBtn');
      const pVol = pipWindowRef.document.getElementById('pipVol') as HTMLInputElement;
      const pVolTxt = pipWindowRef.document.getElementById('pipVolTxt');
      const pType = pipWindowRef.document.getElementById('pipType') as HTMLSelectElement;
      const masterPct = Math.round(masterVolume * 100);
      if (pBtn) {
        pBtn.textContent = isPlaying ? '⏸ Pausar' : '▶ Tocar';
        pBtn.style.background = isPlaying ? 'rgba(242,139,130,0.18)' : '#8ab4f8';
        pBtn.style.color = isPlaying ? '#f28b82' : '#202124';
      }
      if (pVol) pVol.value = String(masterPct);
      if (pVolTxt) pVolTxt.textContent = masterPct + '%';
      if (pType && pType.querySelector(`option[value="${noiseType}"]`)) {
        pType.value = noiseType;
      }
    }

    const masterPct = Math.round(masterVolume * 100);
    if (microMasterVol && document.activeElement !== microMasterVol) microMasterVol.value = String(masterPct);
    if (microMasterVolTxt) microMasterVolTxt.textContent = masterPct + '%';
  }

  function reportPlaybackState() {
    fetch('/playback-state?playing=' + (isPlaying ? 1 : 0), { cache: 'no-store' }).catch(() => {});
  }

  function startPlayback() {
    if (isPlaying) return;
    isPlaying = true;
    appState.playing = true;
    startBaseNoise();
    syncAllNatureSounds();
    syncUIState();
    saveCache();
    reportPlaybackState();
  }

  function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    appState.playing = false;
    stopBaseNoiseSources();
    if (noiseGainNode && audioCtx) {
      noiseGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
      noiseGainNode.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.03);
    }
    syncAllNatureSounds();
    syncUIState();
    saveCache();
    reportPlaybackState();
  }

  function togglePlay() {
    if (!isPlaying) startPlayback();
    else stopPlayback();
  }

  async function initCommandSeq() {
    try {
      const res = await fetch('/get-command?since=999999999', { cache: 'no-store' });
      lastServerCommandSeq = parseInt((await res.text()).split('|')[0], 10) || 0;
    } catch (e) {}
  }

  async function pollServerCommands() {
    try {
      const res = await fetch('/get-command?since=' + lastServerCommandSeq, { cache: 'no-store' });
      const parts = (await res.text()).trim().split('|');
      const seq = parseInt(parts[0], 10) || 0;
      const cmd = parts[1] || 'none';
      if (seq <= lastServerCommandSeq) return;
      lastServerCommandSeq = seq;
      if (cmd === 'pause') stopPlayback();
      else if (cmd === 'resume') startPlayback();
      else if (cmd === 'close' && isAudioHost) {
        stopPlayback();
        window.close();
      }
    } catch (e) {}
  }

  playBtn.addEventListener('click', togglePlay);

  function setNoiseType(type, clearProfile = true) {
    noiseType = type;
    appState.noiseType = type;
    if (clearProfile) {
      appState.activeProfileId = null;
      renderProfilesSidebar();
    }
    const isCustomNoise = (appState.customNoises || []).some(c => c.id === type);
    if (['green', 'grey', 'blue', 'violet'].includes(type) || isCustomNoise) {
      extraNoiseDrawer.classList.add('open');
      expandNoiseBtn.textContent = 'Menos opções ▴';
    }
    document.querySelectorAll<HTMLElement>('.g-chip').forEach(c => {
      c.classList.toggle('selected', c.dataset.type === type);
    });
    if (isPlaying) startBaseNoise();
    syncUIState();
    saveCache();
  }

  document.querySelectorAll<HTMLElement>('.g-chip[data-type]').forEach(chip => {
    chip.addEventListener('click', () => setNoiseType(chip.dataset.type, true));
  });

  function setMasterVolumePercent(rawVal) {
    let m = parseInt(rawVal, 10);
    if (isNaN(m)) m = 100;
    m = Math.max(0, Math.min(100, m));
    masterVolume = m / 100;
    masterVolSlider.value = String(m);
    masterVolInput.value = String(m);
    if (masterGainNode && audioCtx) {
      masterGainNode.gain.setTargetAtTime(Math.max(0.0001, masterVolume), audioCtx.currentTime, 0.02);
    }
    updateAllYouTubeVolumes();
    syncUIState();
    saveCache();
  }

  masterVolSlider.addEventListener('input', (e: any) => setMasterVolumePercent(e.target.value));
  if (microMasterVol) {
    microMasterVol.addEventListener('input', (e: any) => setMasterVolumePercent(e.target.value));
    attachWheelControl(microMasterVol, () => Math.round(masterVolume * 100), v => setMasterVolumePercent(v), 1);
  }
  if (microExpandBtn) {
    microExpandBtn.addEventListener('click', () => {
      if (document.body.classList.contains('mini-mode')) {
        exitCompactMode();
      } else {
        try {
          window.moveTo(80, 80);
          window.resizeTo(520, 720);
        } catch (e) {}
        queueWindowBoundsSave();
      }
    });
  }
  window.addEventListener('keydown', (e: any) => {
    if (e.key === 'Escape' && document.body.classList.contains('mini-mode')) exitCompactMode();
  });
  masterVolInput.addEventListener('input', (e: any) => { if (e.target.value !== '') setMasterVolumePercent(e.target.value); });
  masterVolInput.addEventListener('blur', () => setMasterVolumePercent(masterVolInput.value));
  masterVolInput.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') masterVolInput.blur(); });
  attachWheelControl(document.getElementById('masterVolControl'), () => Math.round(masterVolume * 100), v => setMasterVolumePercent(v), 1);

  function setVolumePercent(rawVal, clearProfile = true) {
    let v = parseInt(rawVal, 10);
    if (isNaN(v)) v = 0;
    v = Math.max(0, Math.min(100, v));
    volume = v / 100;
    volSlider.value = String(v);
    volInput.value = String(v);
    if (clearProfile) {
      appState.activeProfileId = null;
      renderProfilesSidebar();
    }
    if (noiseGainNode && audioCtx && isPlaying) {
      noiseGainNode.gain.setTargetAtTime(Math.max(0.0001, volume), audioCtx.currentTime, 0.02);
    }
    updateAllYouTubeVolumes();
    syncUIState();
    saveCache();
  }

  volSlider.addEventListener('input', (e: any) => setVolumePercent(e.target.value, true));
  volInput.addEventListener('input', (e: any) => { if (e.target.value !== '') setVolumePercent(e.target.value, true); });
  volInput.addEventListener('blur', () => setVolumePercent(volInput.value, true));
  volInput.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') volInput.blur(); });
  attachWheelControl(document.getElementById('baseVolControl'), () => Math.round(volume * 100), v => setVolumePercent(v, true), 1);

  function setCutoffHz(rawVal, clearProfile = true) {
    let hz = parseInt(rawVal, 10);
    if (isNaN(hz)) hz = 276;
    hz = Math.max(80, Math.min(20000, hz));
    cutoffFreq = hz;
    freqSlider.value = String(hz);
    freqInput.value = String(hz);
    if (clearProfile) {
      appState.activeProfileId = null;
      renderProfilesSidebar();
    }
    if (lpFilterNode && audioCtx) {
      lpFilterNode.frequency.setTargetAtTime(cutoffFreq, audioCtx.currentTime, 0.02);
    }
    applyPolishParameters();
    syncUIState();
    saveCache();
  }

  freqSlider.addEventListener('input', (e: any) => setCutoffHz(e.target.value, true));
  freqInput.addEventListener('change', (e: any) => setCutoffHz(e.target.value, true));
  freqInput.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') setCutoffHz(e.target.value, true); });
  attachWheelControl(document.getElementById('freqControl'), () => cutoffFreq, v => setCutoffHz(v, true), 25);

  function setPolishPercent(rawVal, clearProfile = true) {
    let p = parseInt(rawVal, 10);
    if (isNaN(p)) p = 85;
    p = Math.max(0, Math.min(200, p));
    polishLevel = p;
    polishSlider.value = String(p);
    polishInput.value = String(p);

    if (p > 100) {
      polishModeHint.textContent = `Modo Ultra-Velvet ativo (${p}%) — suavização dupla máxima`;
      polishModeHint.style.color = '#81c995';
    } else {
      polishModeHint.textContent = 'Suavização sedosa • acima de 100% ativa Ultra-Velvet';
      polishModeHint.style.color = '';
    }

    if (clearProfile) {
      appState.activeProfileId = null;
      renderProfilesSidebar();
    }
    applyPolishParameters();
    syncUIState();
    saveCache();
  }

  polishSlider.addEventListener('input', (e: any) => setPolishPercent(e.target.value, true));
  polishInput.addEventListener('input', (e: any) => { if (e.target.value !== '') setPolishPercent(e.target.value, true); });
  polishInput.addEventListener('blur', () => setPolishPercent(polishInput.value, true));
  polishInput.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') polishInput.blur(); });
  attachWheelControl(document.getElementById('polishControl'), () => polishLevel, v => setPolishPercent(v, true), 2);

  function activateTimerMinutes(mins, clearProfile = true) {
    configuredTimerMinutes = mins;
    remainingSeconds = mins * 60;
    if (clearProfile) {
      appState.activeProfileId = null;
      renderProfilesSidebar();
    }
    const isPreset = [0, 15, 30, 60].includes(mins);
    document.querySelectorAll<HTMLElement>('.t-chip').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.min, 10) === mins);
    });
    customMinInput.value = (!isPreset && mins > 0) ? String(mins) : '';
    updateTimerDisplay();
    syncUIState();
    saveCache();
  }

  document.querySelectorAll<HTMLElement>('.t-chip').forEach(btn => {
    btn.addEventListener('click', () => activateTimerMinutes(parseInt(btn.dataset.min, 10), true));
  });

  function applyCustomTimer() {
    let m = parseInt(customMinInput.value, 10);
    if (isNaN(m) || m < 1) return;
    activateTimerMinutes(Math.min(999, m), true);
  }

  setCustomTimerBtn.addEventListener('click', applyCustomTimer);
  customMinInput.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') applyCustomTimer(); });
  attachWheelControl(
    document.getElementById('timerWheelWrap'),
    () => parseInt(customMinInput.value, 10) || configuredTimerMinutes || 15,
    v => {
      const clamped = Math.max(1, Math.min(999, v));
      customMinInput.value = String(clamped);
      activateTimerMinutes(clamped, true);
    },
    1
  );

  function updateTimerDisplay() {
    if (remainingSeconds <= 0) {
      timerLabelText.textContent = 'Reprodução contínua ativa';
      timerDisplay.textContent = '';
      return;
    }
    const hrs = Math.floor(remainingSeconds / 3600);
    const mins = Math.floor((remainingSeconds % 3600) / 60);
    const secs = remainingSeconds % 60;
    const formatted = hrs > 0
      ? `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
      : `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    timerLabelText.textContent = 'Desliga automaticamente em';
    timerDisplay.textContent = formatted;
  }

  setInterval(() => {
    if (isPlaying && remainingSeconds > 0) {
      remainingSeconds--;
      updateTimerDisplay();
      if (remainingSeconds === 0) {
        stopPlayback();
        timerLabelText.textContent = 'Temporizador finalizado';
        timerDisplay.textContent = '00:00';
      }
    }
  }, 1000);

  function renderNatureCards() {
    natureList.innerHTML = '';
    const allDefs = getAllSoundDefs();

    allDefs.forEach(def => {
      if (!appState.nature[def.id]) {
        appState.nature[def.id] = { enabled: false, volume: def.defaultVol, tone: def.defaultTone };
      }
      const st = appState.nature[def.id];
      const card = document.createElement('div');
      card.className = 'nature-card' + (st.enabled ? ' active' : '');

      const hasTone = Boolean(def.toneLabel);

      card.innerHTML = `
        <div class="nature-top">
          <div class="nature-info">
            <div class="nature-icon">${def.icon}</div>
            <div style="min-width:0;">
              <div class="nature-name">${def.name}</div>
              <div class="nature-sub">${def.sub}</div>
            </div>
          </div>
          <div class="nature-right-actions">
            ${def.isCustom ? `
              <button class="edit-sound-btn" title="Editar som" aria-label="Editar som">✎</button>
              <button class="del-sound-btn" title="Excluir som" aria-label="Excluir som">×</button>
            ` : ''}
            <label class="g-switch" title="Ativar/Desativar ${def.name}">
              <input type="checkbox" ${st.enabled ? 'checked' : ''}>
              <span class="g-slider"></span>
            </label>
          </div>
        </div>

        <div class="nature-sliders ${hasTone ? '' : 'single-col'}">
          <div class="mini-ctrl nat-vol-box">
            <div class="mini-ctrl-head">
              <span>Volume</span>
              <span class="vol-readout">${st.volume}%</span>
            </div>
            <input class="nat-vol-slider" type="range" min="0" max="100" value="${st.volume}" aria-label="Volume de ${def.name}">
          </div>

          ${hasTone ? `
          <div class="mini-ctrl nat-tone-box">
            <div class="mini-ctrl-head">
              <span>${def.toneLabel}</span>
              <span class="tone-readout">${st.tone}%</span>
            </div>
            <input class="nat-tone-slider" type="range" min="0" max="100" value="${st.tone}" aria-label="${def.toneLabel} de ${def.name}">
          </div>` : ''}
        </div>
      `;

      if (def.isCustom) {
        card.querySelector<HTMLButtonElement>('.edit-sound-btn').addEventListener('click', () => {
          openAddMediaModal('sound', def);
        });
        card.querySelector<HTMLButtonElement>('.del-sound-btn').addEventListener('click', () => {
          stopNatureSound(def.id);
          appState.customSounds = appState.customSounds.filter(s => s.id !== def.id);
          delete appState.nature[def.id];
          if (def.sourceType === 'local') deleteLocalBlobFromDB(def.id);
          renderNatureCards();
          syncUIState();
          saveCache();
        });
      }

      const toggleInput = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const volSl = card.querySelector<HTMLInputElement>('.nat-vol-slider');
      const volReadout = card.querySelector<HTMLElement>('.vol-readout');
      const volBox = card.querySelector('.nat-vol-box');

      toggleInput.addEventListener('change', (e: any) => {
        appState.nature[def.id].enabled = e.target.checked;
        card.classList.toggle('active', e.target.checked);
        appState.activeProfileId = null;
        renderProfilesSidebar();
        syncUIState();
        saveCache();

        if (e.target.checked) {
          if (!isPlaying) startPlayback();
          else startNatureSound(def.id);
        } else {
          stopNatureSound(def.id);
        }
      });

      function updateNatVol(rawV) {
        const v = Math.max(0, Math.min(100, parseInt(rawV, 10) || 0));
        appState.nature[def.id].volume = v;
        volSl.value = String(v);
        volReadout.textContent = v + '%';
        saveCache();
        if (isPlaying && appState.nature[def.id].enabled) {
          const eng = natureEngines[def.id];
          if (eng) {
            if (eng.ytCtrl) {
              eng.ytCtrl.setVolume(masterVolume * (v / 100) * 100);
            } else if (eng.gain && audioCtx) {
              const mult = def.isCustom ? 1 : (typeof def.gainScale === 'number' ? def.gainScale : 0.6);
              eng.gain.gain.setTargetAtTime((v / 100) * mult, audioCtx.currentTime, 0.03);
            }
          }
        }
      }

      volSl.addEventListener('input', (e: any) => updateNatVol(e.target.value));
      attachWheelControl(volBox, () => appState.nature[def.id].volume, updateNatVol, 1);

      if (hasTone) {
        const toneSl = card.querySelector<HTMLInputElement>('.nat-tone-slider');
        const toneReadout = card.querySelector<HTMLElement>('.tone-readout');
        const toneBox = card.querySelector('.nat-tone-box');

        function updateNatTone(rawT) {
          const t = Math.max(0, Math.min(100, parseInt(rawT, 10) || 0));
          appState.nature[def.id].tone = t;
          toneSl.value = String(t);
          toneReadout.textContent = t + '%';
          saveCache();
          if (isPlaying && appState.nature[def.id].enabled) {
            const engine = natureEngines[def.id];
            if (engine && engine.toneFilter && audioCtx) {
              engine.toneFilter.frequency.setTargetAtTime(
                300 + (t / 100) ** 2 * 19700,
                audioCtx.currentTime,
                0.04
              );
            } else {
              startNatureSound(def.id);
            }
          }
        }

        toneSl.addEventListener('input', (e: any) => updateNatTone(e.target.value));
        attachWheelControl(toneBox, () => appState.nature[def.id].tone, updateNatTone, 1);
      }

      natureList.appendChild(card);
    });
  }

  function initSettingsUI() {
    cfgAutoPlay.checked = !!appState.settings.autoPlay;
    cfgAutoPip.checked = !!appState.settings.autoPip;
    cfgStartCompact.checked = !!appState.settings.startCompact;
    cfgRunInBackground.checked = appState.settings.runInBackground !== false;
    cfgScrollStep.value = String(appState.settings.scrollStep || 2);

    cfgAutoPlay.addEventListener('change', (e: any) => {
      appState.settings.autoPlay = e.target.checked;
      saveCache(true);
      if (e.target.checked && !isPlaying) startPlayback();
    });

    cfgAutoPip.addEventListener('change', (e: any) => {
      appState.settings.autoPip = e.target.checked;
      saveCache(true);
      if (e.target.checked) openFloatingMiniTab();
    });

    cfgStartCompact.addEventListener('change', (e: any) => {
      appState.settings.startCompact = e.target.checked;
      saveCache(true);
      if (e.target.checked) enterCompactMode();
      else exitCompactMode();
    });

    cfgRunInBackground.addEventListener('change', (e: any) => {
      appState.settings.runInBackground = e.target.checked;
      saveCache(true);
      fetch('/background-mode?enabled=' + (e.target.checked ? 1 : 0), { cache: 'no-store' }).catch(() => {});
    });

    cfgScrollStep.addEventListener('change', (e: any) => {
      appState.settings.scrollStep = parseInt(e.target.value, 10) || 2;
      saveCache(true);
    });

    resetCacheBtn.addEventListener('click', () => {
      if (confirm('Restaurar todas as configurações e perfis para o padrão?')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('ruido_ambiental_cache_v6');
        localStorage.removeItem('ruido_ambiental_cache_v5');
        location.reload();
      }
    });
  }

  function saveCurrentStateToProfile(profileId) {
    const profile = appState.profiles.find(p => p.id === profileId);
    if (!profile) return;
    Object.assign(profile, captureProfileSettings(profile, {
      noiseType,
      masterVolume: Math.round(masterVolume * 100),
      volume: Math.round(volume * 100),
      cutoffFreq,
      polish: polishLevel,
      timerMinutes: configuredTimerMinutes,
      nature: appState.nature,
      eqGains: appState.eqGains
    }));
  }

  function applyProfile(profile) {
    saveCurrentStateToProfile(lastAppliedProfileId);
    lastAppliedProfileId = profile.id;
    appState.activeProfileId = profile.id;
    setNoiseType(profile.noiseType, false);
    if (typeof profile.masterVolume === 'number') setMasterVolumePercent(profile.masterVolume);
    setVolumePercent(profile.volume, false);
    setCutoffHz(profile.cutoffFreq, false);
    setPolishPercent(typeof profile.polish === 'number' ? profile.polish : 85, false);
    activateTimerMinutes(profile.timerMinutes || 0, false);
    if (Array.isArray(profile.eqGains) && profile.eqGains.length === EQ_BANDS.length) {
      appState.eqGains = profile.eqGains.slice();
      renderEqUI();
      applyEqGains();
    }

    if (profile.nature) {
      appState.nature = JSON.parse(JSON.stringify(Object.assign(JSON.parse(JSON.stringify(DEFAULT_NATURE_STATE)), profile.nature)));
      renderNatureCards();
      syncAllNatureSounds();
    }

    renderProfilesSidebar();
    syncUIState();
    saveCache();
  }

  function deleteProfile(id, event) {
    event.stopPropagation();
    appState.profiles = appState.profiles.filter(p => p.id !== id);
    if (appState.activeProfileId === id) appState.activeProfileId = null;
    if (lastAppliedProfileId === id) lastAppliedProfileId = null;
    renderProfilesSidebar();
    syncUIState();
    saveCache();
  }

  function getProfileIcon(profile, index) {
    return profile.icon || LEGACY_PROFILE_ICONS[profile.id] || PROFILE_ICONS[index % PROFILE_ICONS.length];
  }

  function renderProfilesSidebar() {
    profilesList.innerHTML = '';
    appState.profiles.forEach((prof, index) => {
      const item = document.createElement('div');
      item.className = 'profile-item' + (appState.activeProfileId === prof.id ? ' active' : '');
      item.title = `${prof.name} • ${prof.volume}%`;

      const sq = document.createElement('div');
      sq.className = 'profile-square';
      sq.style.backgroundColor = prof.color;
      sq.textContent = getProfileIcon(prof, index);
      sq.setAttribute('aria-hidden', 'true');

      const del = document.createElement('button');
      del.className = 'profile-del-btn';
      del.textContent = '×';
      del.title = 'Excluir perfil';
      del.addEventListener('click', (e: any) => deleteProfile(prof.id, e));

      const lbl = document.createElement('div');
      lbl.className = 'profile-name';
      lbl.textContent = prof.name;

      item.appendChild(del);
      item.appendChild(sq);
      item.appendChild(lbl);
      item.addEventListener('click', () => applyProfile(prof));

      profilesList.appendChild(item);
    });
  }

  function openCreateProfileModal() {
    newProfileName.value = '';
    selectedModalColor = GOOGLE_COLORS[appState.profiles.length % GOOGLE_COLORS.length];
    selectedModalIcon = PROFILE_ICONS[appState.profiles.length % PROFILE_ICONS.length];

    profileIconPalette.innerHTML = '';
    PROFILE_ICONS.forEach(icon => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'profile-icon-choice' + (icon === selectedModalIcon ? ' selected' : '');
      choice.textContent = icon;
      choice.setAttribute('aria-label', `Usar ícone ${icon}`);
      choice.setAttribute('aria-pressed', String(icon === selectedModalIcon));
      choice.addEventListener('click', () => {
        selectedModalIcon = icon;
        profileIconPalette.querySelectorAll('.profile-icon-choice').forEach(button => {
          button.classList.remove('selected');
          button.setAttribute('aria-pressed', 'false');
        });
        choice.classList.add('selected');
        choice.setAttribute('aria-pressed', 'true');
      });
      profileIconPalette.appendChild(choice);
    });

    colorPalette.innerHTML = '';
    GOOGLE_COLORS.forEach(hex => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (hex === selectedModalColor ? ' selected' : '');
      sw.style.backgroundColor = hex;
      sw.addEventListener('click', () => {
        selectedModalColor = hex;
        document.querySelectorAll<HTMLElement>('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
      });
      colorPalette.appendChild(sw);
    });

    const freePicker = document.createElement('input');
    freePicker.type = 'color';
    freePicker.style.cssText = 'width:28px;height:28px;border:none;border-radius:8px;background:transparent;cursor:pointer;';
    freePicker.value = selectedModalColor;
    freePicker.addEventListener('input', (e: any) => {
      selectedModalColor = e.target.value;
      document.querySelectorAll<HTMLElement>('.color-swatch').forEach(s => s.classList.remove('selected'));
    });
    colorPalette.appendChild(freePicker);

    const activeNatureNames = getAllSoundDefs()
      .filter(d => appState.nature[d.id]?.enabled)
      .map(d => d.name);

    const natureTxt = activeNatureNames.length > 0 ? activeNatureNames.join(', ') : 'Nenhum';

    modalConfigSummary.innerHTML = `
      <strong>Geral:</strong> ${Math.round(masterVolume*100)}% • <strong>Clean:</strong> ${polishLevel}%<br>
      <strong>Sons ativos:</strong> ${natureTxt}
    `;

    profileModal.classList.add('open');
    setTimeout(() => newProfileName.focus(), 40);
  }

  addProfileBtn.addEventListener('click', openCreateProfileModal);
  cancelModalBtn.addEventListener('click', () => profileModal.classList.remove('open'));
  profileModal.addEventListener('click', (e: any) => { if (e.target === profileModal) profileModal.classList.remove('open'); });

  function confirmSaveProfile() {
    const name = newProfileName.value.trim() || `Perfil ${appState.profiles.length + 1}`;
    const newProf = {
      id: 'p_' + Date.now(),
      name: name,
      icon: selectedModalIcon,
      color: selectedModalColor,
      noiseType: noiseType,
      masterVolume: Math.round(masterVolume * 100),
      volume: Math.round(volume * 100),
      cutoffFreq: cutoffFreq,
      polish: polishLevel,
      timerMinutes: configuredTimerMinutes,
      nature: JSON.parse(JSON.stringify(appState.nature))
    };
    appState.profiles.push(newProf);
    appState.activeProfileId = newProf.id;
    lastAppliedProfileId = newProf.id;
    renderProfilesSidebar();
    syncUIState();
    saveCache();
    profileModal.classList.remove('open');
  }

  saveProfileBtn.addEventListener('click', confirmSaveProfile);
  newProfileName.addEventListener('keydown', (e: any) => {
    if (e.key === 'Enter') confirmSaveProfile();
    if (e.key === 'Escape') profileModal.classList.remove('open');
  });

  let windowBoundsTimer = null;

  function saveWindowBounds() {
    try {
      const x = Math.round(window.screenX || 0);
      const y = Math.round(window.screenY || 0);
      const w = Math.max(320, Math.round(window.outerWidth || window.innerWidth));
      const h = Math.max(240, Math.round(window.outerHeight || window.innerHeight));
      fetch(`/bounds?x=${x}&y=${y}&w=${w}&h=${h}`, { cache: 'no-store' }).catch(() => {});
    } catch (e) {}
  }

  function queueWindowBoundsSave() {
    clearTimeout(windowBoundsTimer);
    windowBoundsTimer = setTimeout(saveWindowBounds, 500);
  }

  async function restoreWindowBounds() {
    try {
      const res = await fetch('/get-bounds', { cache: 'no-store' });
      const parts = (await res.text()).trim().split(',').map(Number);
      if (parts.length !== 4 || parts.some(n => !isFinite(n))) return;
      const x = parts[0], y = parts[1], w = parts[2], h = parts[3];
      try {
        window.moveTo(x, y);
        window.resizeTo(w, h);
      } catch (e) {}
      if (w <= 420 || h <= 320) setTimeout(() => enterCompactMode(), 60);
    } catch (e) {}
  }

  window.addEventListener('resize', () => { queueWindowBoundsSave(); drawEqCurve(); });
  window.addEventListener('move', queueWindowBoundsSave);
  window.addEventListener('beforeunload', () => {
    if (isAudioHost) return;
    saveCurrentStateToProfile(lastAppliedProfileId);
    saveCache();
    saveWindowBounds();
    try { navigator.sendBeacon('/window-closed'); } catch (e) {}
  });

  let preCompactBounds = null;

  function enterCompactMode() {
    if (!document.body.classList.contains('mini-mode') && !preCompactBounds) {
      preCompactBounds = {
        x: window.screenX,
        y: window.screenY,
        w: window.outerWidth,
        h: window.outerHeight
      };
    }
    document.body.classList.add('mini-mode');
    pipBtn.classList.add('active');
    pipLabel.textContent = 'Expandir';
    try { window.resizeTo(360, 275); } catch (e) {}
    queueWindowBoundsSave();
  }

  function exitCompactMode() {
    document.body.classList.remove('mini-mode');
    pipBtn.classList.remove('active');
    pipLabel.textContent = 'Abinha';
    renderTabsAndPanels(false);
    if (preCompactBounds) {
      try {
        window.moveTo(preCompactBounds.x, preCompactBounds.y);
        window.resizeTo(preCompactBounds.w, preCompactBounds.h);
      } catch (e) {}
      preCompactBounds = null;
    }
    queueWindowBoundsSave();
  }

  async function tryOpenDocumentPip() {
    if (!('documentPictureInPicture' in window)) return false;
    try {
      if (pipWindowRef && !pipWindowRef.closed) return true;
      const pipWin = await window.documentPictureInPicture.requestWindow({ width: 320, height: 162 });
      pipWindowRef = pipWin;
      pipBtn.classList.add('active');

      const masterPct = Math.round(masterVolume * 100);
      pipWin.document.body.innerHTML = `
        <div id="pipRoot" style="margin:0;padding:12px;background:#202124;color:#e8eaed;font-family:'Google Sans','Segoe UI',sans-serif;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;user-select:none;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span style="font-size:13px;font-weight:500;">Ruído Ambiental</span>
            <select id="pipType" style="background:#303134;color:#e8eaed;border:1px solid #3c4043;border-radius:8px;padding:3px 6px;font-size:11px;outline:none;">
              <option value="white">Branco</option>
              <option value="pink">Rosa</option>
              <option value="brown">Marrom</option>
              <option value="green">Verde</option>
              <option value="grey">Cinza</option>
              <option value="blue">Azul</option>
              <option value="violet">Violeta</option>
            </select>
          </div>
          <div id="pipVolRow" style="display:flex;align-items:center;gap:8px;padding:4px 0;" title="Controle de Volume Geral (Tudo) • Use o scroll do mouse">
            <span style="font-size:11px;color:#9aa0a6;white-space:nowrap;">Geral</span>
            <input id="pipVol" type="range" min="0" max="100" value="${masterPct}" style="flex:1;accent-color:#8ab4f8;cursor:pointer;">
            <span id="pipVolTxt" style="font-size:12px;font-weight:600;color:#8ab4f8;width:36px;text-align:right;">${masterPct}%</span>
          </div>
          <button id="pipPlayBtn" style="width:100%;height:34px;border:none;border-radius:17px;background:${isPlaying ? 'rgba(242,139,130,0.18)' : '#8ab4f8'};color:${isPlaying ? '#f28b82' : '#202124'};font-weight:600;font-size:13px;cursor:pointer;">
            ${isPlaying ? '⏸ Pausar' : '▶ Tocar'}
          </button>
        </div>
      `;
      pipWin.document.body.style.margin = '0';

      const pBtn = pipWin.document.getElementById('pipPlayBtn');
      const pVol = pipWin.document.getElementById('pipVol') as HTMLInputElement;
      const pVolRow = pipWin.document.getElementById('pipVolRow');
      const pType = pipWin.document.getElementById('pipType') as HTMLSelectElement;
      if (pType.querySelector(`option[value="${noiseType}"]`)) pType.value = noiseType;

      pBtn.addEventListener('click', togglePlay);
      pVol.addEventListener('input', (e: any) => setMasterVolumePercent(e.target.value));
      pVolRow.addEventListener('wheel', (e: any) => {
        e.preventDefault();
        const step = appState.settings.scrollStep || 2;
        const delta = e.deltaY < 0 ? step : -step;
        setMasterVolumePercent(Math.round(masterVolume * 100) + delta);
      }, { passive: false });
      pType.addEventListener('change', (e: any) => setNoiseType(e.target.value, true));

      pipWin.addEventListener('pagehide', () => {
        pipWindowRef = null;
        pipBtn.classList.remove('active');
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  async function openFloatingMiniTab() {
    if (document.body.classList.contains('mini-mode')) {
      exitCompactMode();
      return;
    }
    if (pipWindowRef && !pipWindowRef.closed) {
      pipWindowRef.close();
      pipWindowRef = null;
      pipBtn.classList.remove('active');
      return;
    }
    const openedPip = await tryOpenDocumentPip();
    if (!openedPip) enterCompactMode();
  }

  pipBtn.addEventListener('click', openFloatingMiniTab);

  const SPECTRUM_BARS = 64;
  const spectrumLevels = new Array(SPECTRUM_BARS).fill(0);
  const spectrumPeaks = new Array(SPECTRUM_BARS).fill(0);

  function fitCanvas(canvasEl, ctx2d) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(120, canvasEl.clientWidth || canvasEl.width);
    const ch = Math.max(40, canvasEl.clientHeight || canvasEl.height);
    const bw = Math.round(cw * dpr);
    const bh = Math.round(ch * dpr);
    if (canvasEl.width !== bw || canvasEl.height !== bh) {
      canvasEl.width = bw;
      canvasEl.height = bh;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: cw, h: ch };
  }

  function drawSpectrum() {
    requestAnimationFrame(drawSpectrum);
    const size = fitCanvas(canvas, ctx);
    const w = size.w;
    const h = size.h;
    ctx.clearRect(0, 0, w, h);

    const bars = SPECTRUM_BARS;
    const gap = Math.max(1, w / 320);
    const barW = Math.max(1.5, (w - (bars - 1) * gap) / bars);
    const target = new Array(bars).fill(0);

    if (masterAnalyser && isPlaying) {
      const raw = new Uint8Array(masterAnalyser.frequencyBinCount);
      masterAnalyser.getByteFrequencyData(raw);
      const maxBin = Math.max(8, Math.floor(raw.length * 0.82));
      for (let i = 0; i < bars; i++) {
        const b0 = Math.max(1, Math.floor(Math.pow(maxBin, i / bars)));
        const b1 = Math.max(b0 + 1, Math.floor(Math.pow(maxBin, (i + 1) / bars)));
        let sum = 0;
        let count = 0;
        for (let b = b0; b < b1 && b < raw.length; b++) {
          sum += raw[b];
          count++;
        }
        const avg = count ? sum / count : 0;
        const tilt = 0.7 + 0.55 * (i / bars);
        target[i] = Math.min(1, (avg / 255) * tilt);
      }
    }

    const time = performance.now() / 1000;
    for (let i = 0; i < bars; i++) {
      if (!isPlaying) {
        target[i] = 0.1 + 0.05 * Math.sin(time * 1.7 + i * 0.38) + 0.025 * Math.sin(time * 0.8 - i * 0.16);
      }
      const prev = spectrumLevels[i] || 0;
      spectrumLevels[i] = target[i] > prev
        ? prev + (target[i] - prev) * 0.45
        : prev + (target[i] - prev) * 0.14;
      spectrumPeaks[i] = Math.max(spectrumLevels[i], (spectrumPeaks[i] || 0) - 0.005);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let line = 1; line < 4; line++) {
      const y = (h / 4) * line;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    if (isPlaying) {
      grad.addColorStop(0, '#f72558');
      grad.addColorStop(0.55, '#ff7526');
      grad.addColorStop(1, '#f5b822');
    } else {
      grad.addColorStop(0, '#3c4043');
      grad.addColorStop(1, '#5f6368');
    }

    ctx.fillStyle = grad;
    ctx.shadowColor = isPlaying ? 'rgba(255,117,38,0.38)' : 'transparent';
    ctx.shadowBlur = isPlaying ? 8 : 0;

    const usable = h - 10;
    for (let i = 0; i < bars; i++) {
      const bh = Math.max(3, spectrumLevels[i] * usable);
      const x = i * (barW + gap);
      const y = (h - bh) / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, bh, Math.min(barW / 2, 3));
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < bars; i++) {
      const py = (h - spectrumPeaks[i] * usable) / 2;
      ctx.fillRect(i * (barW + gap), py - 1, barW, 1.5);
    }
  }

  function drawEqCurve() {
    if (!eqCurveCtx || !eqCurveCanvas) return;
    const size = fitCanvas(eqCurveCanvas, eqCurveCtx);
    const w = size.w;
    const h = size.h;
    eqCurveCtx.clearRect(0, 0, w, h);

    eqCurveCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    eqCurveCtx.lineWidth = 1;
    for (let line = 1; line < 4; line++) {
      const y = (h / 4) * line;
      eqCurveCtx.beginPath();
      eqCurveCtx.moveTo(0, y);
      eqCurveCtx.lineTo(w, y);
      eqCurveCtx.stroke();
    }

    const midY = h / 2;
    eqCurveCtx.strokeStyle = 'rgba(138,180,248,0.22)';
    eqCurveCtx.beginPath();
    eqCurveCtx.moveTo(0, midY);
    eqCurveCtx.lineTo(w, midY);
    eqCurveCtx.stroke();

    if (!audioCtx || eqFilters.length !== EQ_BANDS.length) return;

    const points = 192;
    const freqs = new Float32Array(points);
    const mag = new Float32Array(points);
    const phase = new Float32Array(points);
    const total = new Float32Array(points);
    total.fill(1);
    for (let i = 0; i < points; i++) freqs[i] = 20 * Math.pow(1000, i / (points - 1));

    eqFilters.forEach(filter => {
      filter.getFrequencyResponse(freqs, mag, phase);
      for (let i = 0; i < points; i++) total[i] *= mag[i];
    });

    const curveGrad = eqCurveCtx.createLinearGradient(0, 0, w, 0);
    curveGrad.addColorStop(0, '#8ab4f8');
    curveGrad.addColorStop(0.5, '#c58af9');
    curveGrad.addColorStop(1, '#81c995');
    eqCurveCtx.strokeStyle = curveGrad;
    eqCurveCtx.lineWidth = 2;
    eqCurveCtx.shadowColor = 'rgba(138,180,248,0.35)';
    eqCurveCtx.shadowBlur = 6;
    eqCurveCtx.beginPath();

    for (let i = 0; i < points; i++) {
      const db = 20 * Math.log10(Math.max(0.0001, total[i]));
      const x = (i / (points - 1)) * w;
      const y = midY - (Math.max(-12, Math.min(12, db)) / 12) * (midY - 8);
      if (i === 0) eqCurveCtx.moveTo(x, y);
      else eqCurveCtx.lineTo(x, y);
    }
    eqCurveCtx.stroke();
    eqCurveCtx.shadowBlur = 0;

    eqCurveCtx.fillStyle = 'rgba(232,234,237,0.6)';
    EQ_BANDS.forEach(band => {
      const x = (Math.log(band.freq / 20) / Math.log(1000)) * w;
      eqCurveCtx.fillRect(x - 1, h - 8, 2, 5);
    });
  }

  async function initApp() {
    if (!isAudioHost) restoreWindowBounds();
    renderCustomNoiseChips();
    setNoiseType(appState.noiseType, false);
    setMasterVolumePercent(appState.masterVolume);
    setVolumePercent(appState.volume, false);
    setCutoffHz(appState.cutoffFreq, false);
    setPolishPercent(appState.polish, false);
    activateTimerMinutes(appState.timerMinutes, false);
    renderNatureCards();
    renderProfilesSidebar();
    renderEqUI();
    initSettingsUI();
    renderTabsAndPanels(false);
    applyUiLock();
    refreshDownloadStatus();
    syncUIState();
    if (!isAudioHost) drawSpectrum();

    await initCommandSeq();
    setInterval(pollServerCommands, 400);
    if (isAudioHost) {
      reportPlaybackState();
    } else {
      fetch('/background-mode?enabled=' + (appState.settings.runInBackground !== false ? 1 : 0), { cache: 'no-store' }).catch(() => {});
      fetch('/page-alive', { cache: 'no-store' }).catch(() => {});
      setInterval(() => fetch('/page-alive', { cache: 'no-store' }).catch(() => {}), 1200);
      if (appState.settings.startCompact) {
        setTimeout(() => enterCompactMode(), 60);
      }
    }

    if (isAudioHost ? appState.playing : (appState.settings.autoPlay || appState.playing)) {
      startPlayback();
      const resumeCheck = setInterval(() => {
        if (!appState.settings.autoPlay || !isPlaying) {
          clearInterval(resumeCheck);
          return;
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        } else if (audioCtx && audioCtx.state === 'running') {
          clearInterval(resumeCheck);
        }
      }, 300);

      const unlockOnGesture = () => {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (appState.settings.autoPlay && !isPlaying) startPlayback();
        window.removeEventListener('pointerdown', unlockOnGesture);
        window.removeEventListener('keydown', unlockOnGesture);
      };
      window.addEventListener('pointerdown', unlockOnGesture);
      window.addEventListener('keydown', unlockOnGesture);
    }

    if (!isAudioHost && appState.settings.autoPip) {
      const opened = await tryOpenDocumentPip();
      if (!opened) {
        const openPipOnFirstClick = async () => {
          window.removeEventListener('pointerdown', openPipOnFirstClick);
          if (appState.settings.autoPip && (!pipWindowRef || pipWindowRef.closed)) {
            await tryOpenDocumentPip();
          }
        };
        window.addEventListener('pointerdown', openPipOnFirstClick);
      }
    }
  }

  initApp();
