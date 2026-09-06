/* Presentation and navigation for the composer. Artwork lives in sketch.js. */
(() => {
  let section = 'style';
  let signature = '';
  let modeSignature = '';
  let noticeTimer;
  const $ = (id) => document.getElementById(id);
  const intros = {style:'Find the rhythm in every letter.', ink:'A little texture. A lot of character.', paper:'Every composition starts here.', plot:'From the page to the pen.'};
  const isTyping = (target) => target?.closest('input, textarea, select, [contenteditable="true"]');

  function showSection(next) {
    section = next;
    document.querySelectorAll('.inspector-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.section === section)));
    document.querySelectorAll('.rail-left .panel-card[data-section]').forEach(panel => {
      const key = panel.dataset.section;
      const visible = key === section || (appState.mode === 'draw' && section === 'style' && key === 'draw');
      panel.classList.toggle('section-hidden', !visible);
    });
    $('inspectorIntro').textContent = appState.mode === 'draw' && section === 'style' ? 'Make your mark. Follow your hand.' : intros[section];
    // Text ink settings cannot affect freehand strokes; brush controls can.
    if (appState.mode === 'draw' && section === 'ink') {
      document.querySelector('[data-section="ink"].panel-card').classList.add('section-hidden');
      document.querySelector('[data-section="draw"].panel-card').classList.remove('section-hidden');
    }
    $('streamActionsCard').classList.toggle('section-hidden', section !== 'plot');
  }

  function chooseTool(mode, tool = 'draw') {
    drawUI.tool = tool;
    setAppMode(mode);
    refreshPanes();
    showSection('style');
    refresh();
  }

  function toggleFocus() {
    const focused = document.body.classList.toggle('focus-mode');
    $('focusBtn').setAttribute('aria-pressed', String(focused));
    P.fitToViewport = true;
    P.previewScale = 1;
    syncDisplaySize();
    announce(focused ? 'Focus on the page · press F to return' : 'Workbench restored');
  }

  function announce(message) {
    clearTimeout(noticeTimer);
    $('studioNotice').textContent = message;
    $('studioNotice').classList.add('visible');
    noticeTimer = setTimeout(() => $('studioNotice').classList.remove('visible'), 2300);
  }

  function zoom(factor) {
    const rect = wrapEl.getBoundingClientRect();
    const next = clamp(viewport.scale * factor, .1, 8);
    const ratio = next / viewport.scale;
    viewport.x = rect.width / 2 - (rect.width / 2 - viewport.x) * ratio;
    viewport.y = rect.height / 2 - (rect.height / 2 - viewport.y) * ratio;
    viewport.scale = next;
    P.fitToViewport = false;
    P.previewScale = next;
    applyViewportTransform();
    requestRender();
  }

  function refresh() {
    if (!$('layerList')) return;
    // Tweakpane renders visual labels as divs; give its native fields accessible names.
    document.querySelectorAll('.tp-lblv').forEach(row => {
      const label = row.querySelector('.tp-lblv_l')?.textContent?.trim();
      if (label) row.querySelectorAll('input, select').forEach(input => {
        if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', label);
      });
    });
    const nextSignature = JSON.stringify([activeBoxId, appState.mode, state.boxes.map(b => [b.id, b.text, b.fontSizeMM])]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      const list = $('layerList');
      const focusedLayer = list.contains(document.activeElement) ? document.activeElement.dataset.layerId : null;
      list.replaceChildren();
      for (const [index, box] of state.boxes.entries()) {
        const button = document.createElement('button');
        button.className = 'layer-item';
        button.dataset.layerId = String(box.id);
        button.setAttribute('aria-pressed', String(box.id === activeBoxId));
        button.setAttribute('aria-label', `Select text layer ${index + 1}: ${box.text || 'Empty text'}`);
        const glyph = document.createElement('span');
        glyph.className = 'layer-glyph';
        glyph.textContent = 'Aa';
        glyph.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span');
        copy.className = 'layer-copy';
        const title = document.createElement('strong');
        title.textContent = box.text.trim().replace(/\s+/g, ' ') || 'Empty text layer';
        const meta = document.createElement('small');
        meta.textContent = `TEXT ${String(index + 1).padStart(2, '0')} · ${box.fontSizeMM.toFixed(1)} mm`;
        copy.append(title, meta);
        button.append(glyph, copy);
        button.addEventListener('click', () => {
          if (appState.mode !== 'text') chooseTool('text');
          activeBoxId = box.id;
          refreshSelectionMonitor();
          requestRender();
        });
        list.append(button);
        if (focusedLayer === String(box.id)) button.focus({preventScroll: true});
      }
      if (!state.boxes.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-layers';
        empty.textContent = 'A blank page, a fresh possibility. Add a text layer to begin.';
        list.append(empty);
      }
      $('layerCount').textContent = state.boxes.length;
    }
    const currentMode = `${appState.mode}:${drawUI.tool}`;
    if (modeSignature !== currentMode) {
      modeSignature = currentMode;
      document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === appState.mode && (appState.mode === 'text' || button.dataset.tool === drawUI.tool))));
      showSection(section);
    }
    $('stageHint').textContent = appState.mode === 'text' ? 'Drag a layer to arrange · double-click letters for alternates' : drawUI.tool === 'lasso' ? 'Draw a loop around strokes to select them' : drawUI.tool === 'transform' ? 'Lasso strokes first, then drag their handles' : 'Draw on paper · two-finger scroll to pan';
    $('zoomLabel').textContent = `${Math.round(viewport.scale * 100)}%`;
    $('paperSummary').textContent = `${P.paperPreset} · ${P.canvasWMM} × ${P.canvasHMM} mm`;
    $('guidesToggle').textContent = P.showGuides ? 'Guides on' : 'Guides off';
    $('guidesToggle').setAttribute('aria-pressed', String(P.showGuides));
    document.querySelectorAll('#inkSwatches button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color.toLowerCase() === P.textColor.toLowerCase())));
    ['alignLeftBtn', 'alignCenterBtn', 'alignRightBtn'].forEach(id => {
      $(id).disabled = !getActiveBox();
      $(id).setAttribute('aria-pressed', String($(id).classList.contains('active')));
    });
    for (const blade of Object.values(selectedBoxBindings)) blade.disabled = !getActiveBox();
  }

  window.ComposerStudio = {refresh};
  window.addEventListener('load', () => {
    // Start with the existing first layer selected so the editor is immediately usable.
    activeBoxId = state.boxes[0]?.id ?? null;
    refreshSelectionMonitor();
    document.querySelectorAll('.inspector-tabs button').forEach(button => button.addEventListener('click', () => showSection(button.dataset.section)));
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => chooseTool(button.dataset.mode, button.dataset.tool)));
    $('focusBtn').addEventListener('click', toggleFocus);
    $('zoomInBtn').addEventListener('click', () => zoom(1.2));
    $('zoomOutBtn').addEventListener('click', () => zoom(1 / 1.2));
    $('guidesToggle').addEventListener('click', () => {P.showGuides = !P.showGuides; refreshPanes(); requestRender();});
    $('addBoxBtn').addEventListener('click', () => {showSection('style'); $('boxTextInput').focus(); $('boxTextInput').select();});
    // The dock owns mode switching; avoid a second, competing mode control.
    document.querySelector('#docPane .tp-lblv')?.classList.add('hidden');
    function revealSection(next) {
      if (document.body.classList.contains('focus-mode')) toggleFocus();
      showSection(next);
      document.querySelector('.rail-left').scrollIntoView({block: 'nearest'});
    }
    const actions = [
      ['Add text layer', 'N', () => {chooseTool('text'); $('addBoxBtn').click();}],
      ['Compose lettering', 'T', () => chooseTool('text')],
      ['Draw with a nib', 'B', () => chooseTool('draw','draw')],
      ['Lasso strokes', 'L', () => chooseTool('draw','lasso')],
      ['Transform strokes', 'V', () => chooseTool('draw','transform')],
      ['Fit paper to view', '0', () => $('fitBtn').click()],
      ['Toggle focus mode', 'F', toggleFocus],
      ['Paper settings', '', () => revealSection('paper')],
      ['Ink and brush settings', '', () => revealSection('ink')],
      ['Plotter settings', '', () => revealSection('plot')],
      ['Export artwork SVG', '', () => $('svgBtn').click()],
      ['Export paths SVG', '', () => $('pathSvgBtn').click()],
    ];
    let actionIndex = 0;
    let filtered = actions;
    function drawActions() {
      filtered = actions.filter(a => a[0].toLowerCase().includes($('commandSearch').value.toLowerCase()));
      actionIndex = 0;
      $('commandResults').replaceChildren();
      filtered.forEach((action, index) => {
        const button = document.createElement('button');
        button.textContent = action[0];
        const key = document.createElement('kbd'); key.textContent = action[1] || '↵'; button.append(key);
        button.dataset.active = String(index === actionIndex);
        button.addEventListener('click', () => {$('commandDialog').close(); action[2]();});
        $('commandResults').append(button);
      });
      if (!filtered.length) $('commandResults').textContent = 'No matching actions. Try “paper” or “draw”.';
    }
    function openCommands() {$('commandSearch').value = ''; drawActions(); $('commandDialog').showModal(); $('commandSearch').focus();}
    $('commandBtn').addEventListener('click', openCommands);
    $('closeCommandBtn').addEventListener('click', () => $('commandDialog').close());
    $('commandSearch').addEventListener('input', drawActions);
    $('commandSearch').addEventListener('keydown', event => {
      if (!filtered.length) return;
      if (event.key === 'Enter') {event.preventDefault(); $('commandDialog').close(); filtered[actionIndex][2]();}
      if (['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault(); actionIndex = (actionIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
        [...$('commandResults').children].forEach((button, index) => button.dataset.active = String(index === actionIndex));
        $('commandResults').children[actionIndex]?.scrollIntoView({block:'nearest'});
      }
    });
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {event.preventDefault(); if (!$('commandDialog').open) openCommands(); return;}
      if (isTyping(event.target) || $('commandDialog').open || event.metaKey || event.ctrlKey || event.altKey) return;
      const action = actions.find(a => a[1].toLowerCase() === event.key.toLowerCase());
      if (action) {event.preventDefault(); action[2]();}
      if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) toggleFocus();
    });
    new ResizeObserver(() => syncDisplaySize()).observe(wrapEl);
    showSection('style');
    refresh();
    requestRender();
  });
})();
