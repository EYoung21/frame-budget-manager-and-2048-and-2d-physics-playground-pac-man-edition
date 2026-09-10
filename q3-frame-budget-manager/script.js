// Frame Budget Manager
// Simulates a 60fps game loop with input/logic/render/audio subsystems,
// per-subsystem budgets, expensive-operation capping, a deferral queue for
// non-critical work, and adaptive quality reduction under sustained load.

document.addEventListener('DOMContentLoaded', () => {
  // ---- constants -----------------------------------------------------
  const FRAME_BUDGET = 16.7; // ms, target 60fps
  const SUB_BUDGET = { input: 2.5, logic: 6.5, render: 6.0, audio: 1.2 };
  const NONCRITICAL_WORK = {
    render: ['Asset decode', 'Particle FX'],
    logic: ['AI pathfinding'],
  };
  const TIMELINE_MAX_BARS = 70;

  // ---- state -----------------------------------------------------------
  let responsiveness = 50;   // 0 (chunky) - 100 (smooth)
  let userQuality = 100;     // manual render quality 20-100
  let adaptiveQuality = 100; // auto-reduced under sustained overload
  let deferEnabled = true;

  let deferredQueue = [];    // { id, name, sub, remainingMs }
  let overBudgetStreak = 0;
  let lastFrameTime = performance.now();
  let fpsHistory = [];
  let frameCount = 0;

  let gcPausePending = false;
  let assetSpikeFrames = 0;
  let aiSpikeFrames = 0;

  // ---- element refs ------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const fpsCounterEl = el('fps-counter');
  const overheadEl = el('overhead-value');
  const warningBanner = el('warning-banner');
  const adaptiveIndicator = el('adaptive-indicator');
  const statusLogEl = el('status-log');
  const timelineEl = el('frame-timeline');
  const queueListEl = el('deferred-queue-list');

  const responsivenessSlider = el('responsiveness-slider');
  const responsivenessValueEl = el('responsiveness-value');
  const qualitySlider = el('quality-slider');
  const qualityValueEl = el('quality-value');
  const deferCheckbox = el('defer-checkbox');
  const applyBtn = el('apply-budget-btn');

  const gcBtn = el('gc-pause-btn');
  const assetBtn = el('asset-spike-btn');
  const aiBtn = el('ai-spike-btn');

  const barFill = { input: el('input-bar-fill'), logic: el('logic-bar-fill'), render: el('render-bar-fill'), audio: el('audio-bar-fill') };
  const barValue = { input: el('input-value'), logic: el('logic-value'), render: el('render-value'), audio: el('audio-value') };
  const barFlag = { input: el('input-flag'), logic: el('logic-flag'), render: el('render-flag'), audio: el('audio-flag') };

  // ---- helpers -----------------------------------------------------------
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function logStatus(msg) {
    statusLogEl.textContent = msg;
  }

  function updateSubsystemUI(sub, value, budget) {
    const widthPct = clamp((value / 20) * 100, 0, 100);
    barFill[sub].style.width = widthPct + '%';
    const ratio = value / budget;
    barFill[sub].classList.remove('ok', 'warn', 'over');
    if (ratio > 1.15) {
      barFill[sub].classList.add('over');
      barFlag[sub].textContent = 'OVER';
    } else if (ratio > 0.8) {
      barFill[sub].classList.add('warn');
      barFlag[sub].textContent = '';
    } else {
      barFill[sub].classList.add('ok');
      barFlag[sub].textContent = '';
    }
    barValue[sub].textContent = value.toFixed(1) + 'ms';
  }

  function addTimelineBar(frameClass, total) {
    const bar = document.createElement('div');
    bar.className = 'frame-bar ' + frameClass;
    const heightPct = clamp((total / (FRAME_BUDGET * 2.5)) * 100, 15, 100);
    bar.style.height = heightPct + '%';
    timelineEl.appendChild(bar);
    while (timelineEl.children.length > TIMELINE_MAX_BARS) {
      timelineEl.removeChild(timelineEl.firstChild);
    }
  }

  function renderDeferredQueue() {
    queueListEl.innerHTML = '';
    if (deferredQueue.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No deferred work';
      queueListEl.appendChild(li);
      return;
    }
    deferredQueue.slice(0, 8).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = `${item.name} (${item.sub}) — ${item.remainingMs.toFixed(1)}ms remaining`;
      queueListEl.appendChild(li);
    });
  }

  // Cap an expensive subsystem to its (responsiveness-scaled) budget;
  // anything above the cap becomes deferred non-critical work.
  function capSubsystem(sub, rawMs, budget, capFactor) {
    const cap = budget * capFactor;
    if (rawMs <= cap) return rawMs;
    const overflow = rawMs - cap;
    if (deferEnabled) {
      const pool = NONCRITICAL_WORK[sub];
      if (pool) {
        const name = pool[Math.floor(Math.random() * pool.length)];
        deferredQueue.push({ id: Date.now() + Math.random(), name, sub, remainingMs: overflow });
      }
    }
    return cap;
  }

  // ---- main loop -----------------------------------------------------
  function tick(now) {
    const overheadStart = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    frameCount++;

    // Input is the critical path: always processed fully, never capped/deferred.
    const inputTime = rand(1.0, 2.4);

    let logicRaw = rand(3, 6);
    if (aiSpikeFrames > 0) { logicRaw += rand(15, 25); aiSpikeFrames--; }

    const effectiveQuality = Math.min(userQuality, adaptiveQuality);
    let renderRaw = rand(3, 5) * (effectiveQuality / 100);
    if (assetSpikeFrames > 0) { renderRaw += rand(18, 32); assetSpikeFrames--; }

    const audioTime = rand(0.5, 1.4);

    if (gcPausePending) {
      logicRaw += rand(100, 150); // simulated GC pause stalls the logic step
      gcPausePending = false;
    }

    // responsiveness: smooth(100) => tight caps (throttle sooner, lower latency)
    //                 chunky(0)   => loose caps (let work run longer, fewer deferrals)
    const capFactor = 2.2 - (responsiveness / 100) * 1.2;

    const logicTime = capSubsystem('logic', logicRaw, SUB_BUDGET.logic, capFactor);
    const renderTime = capSubsystem('render', renderRaw, SUB_BUDGET.render, capFactor);

    let subtotal = inputTime + logicTime + renderTime + audioTime;
    let headroom = FRAME_BUDGET - subtotal;
    const chunk = 1.0 + (responsiveness / 100) * 2.0;

    while (headroom > 0.3 && deferredQueue.length > 0) {
      const item = deferredQueue[0];
      const take = Math.min(item.remainingMs, headroom, chunk);
      item.remainingMs -= take;
      headroom -= take;
      subtotal += take;
      if (item.remainingMs <= 0.05) deferredQueue.shift();
      else break;
    }

    const total = subtotal;

    // Adaptive quality: sustained overload silently trims quality; recovers slowly.
    if (total > FRAME_BUDGET * 1.15) overBudgetStreak++;
    else overBudgetStreak = Math.max(0, overBudgetStreak - 1);

    if (overBudgetStreak > 20 && adaptiveQuality > 40) {
      adaptiveQuality = clamp(adaptiveQuality - 2, 40, 100);
    } else if (overBudgetStreak === 0 && adaptiveQuality < 100 && Math.random() < 0.02) {
      adaptiveQuality = clamp(adaptiveQuality + 1, 40, 100);
    }

    // Frame classification for the timeline / dropped-frame handling.
    let frameClass = 'ok';
    if (total > FRAME_BUDGET * 3) frameClass = 'skipped'; // treated as a dropped frame: game state clamps dt instead of jumping
    else if (total > FRAME_BUDGET * 1.1) frameClass = 'warn';

    updateSubsystemUI('input', inputTime, SUB_BUDGET.input);
    updateSubsystemUI('logic', logicTime, SUB_BUDGET.logic);
    updateSubsystemUI('render', renderTime, SUB_BUDGET.render);
    updateSubsystemUI('audio', audioTime, SUB_BUDGET.audio);

    warningBanner.classList.toggle('hidden', assetSpikeFrames <= 0);
    adaptiveIndicator.classList.toggle('hidden', adaptiveQuality >= 100);

    addTimelineBar(frameClass, total);
    renderDeferredQueue();

    fpsHistory.push(dt);
    if (fpsHistory.length > 30) fpsHistory.shift();
    if (frameCount % 10 === 0) {
      const avgDt = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
      fpsCounterEl.textContent = avgDt > 0 ? Math.round(1000 / avgDt) : '--';
    }

    const overheadEnd = performance.now();
    overheadEl.textContent = (overheadEnd - overheadStart).toFixed(2);

    requestAnimationFrame(tick);
  }

  // ---- UI wiring -------------------------------------------------------
  responsivenessSlider.addEventListener('input', () => {
    responsiveness = Number(responsivenessSlider.value);
    responsivenessValueEl.textContent = String(responsiveness);
  });

  qualitySlider.addEventListener('input', () => {
    userQuality = Number(qualitySlider.value);
    qualityValueEl.textContent = userQuality + '%';
  });

  deferCheckbox.addEventListener('change', () => {
    deferEnabled = deferCheckbox.checked;
  });

  applyBtn.addEventListener('click', () => {
    adaptiveQuality = 100; // give the manual settings a fresh baseline
    overBudgetStreak = 0;
    logStatus(`Budget applied — responsiveness ${responsiveness}, quality ${userQuality}%, defer ${deferEnabled ? 'on' : 'off'}.`);
  });

  gcBtn.addEventListener('click', () => {
    gcPausePending = true;
    logStatus('GC pause injected — next frame will spike 100ms+.');
  });

  assetBtn.addEventListener('click', () => {
    assetSpikeFrames = 90;
    logStatus('Asset load spike triggered — render subsystem under load.');
  });

  aiBtn.addEventListener('click', () => {
    aiSpikeFrames = 90;
    logStatus('AI combat spike triggered — game logic under load.');
  });

  // init
  responsivenessValueEl.textContent = String(responsiveness);
  qualityValueEl.textContent = userQuality + '%';
  renderDeferredQueue();
  requestAnimationFrame(tick);
});

