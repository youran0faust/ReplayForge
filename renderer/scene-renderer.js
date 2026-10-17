/* Both pages render at design pixels; only the preview wrapper is scaled. */
function createSceneRenderer(stage, options = {}) {
  stage.classList.add('stage');
  const background = document.createElement('div');
  const characters = document.createElement('div');
  const dialogue = document.createElement('div');
  background.className = 'background'; background.id = 'background';
  characters.className = 'characters';
  dialogue.className = 'dialogue'; dialogue.id = 'dialogue';
  const speaker = document.createElement('div');
  const body = document.createElement('div');
  speaker.className = 'dialogue-speaker'; speaker.id = 'default-dialogue-speaker';
  body.className = 'dialogue-body'; body.id = 'dialogue-body';
  dialogue.appendChild(speaker); dialogue.appendChild(body);
  stage.replaceChildren(background, characters, dialogue);
  const textFactory = typeof module !== 'undefined' && module.exports ? require('./text-revealer.js').createTextRevealer : createTextRevealer;
  const revealer = textFactory(body);
  const images = new Map();
  const rasterUrls = new Map();
  let lastRender;
  let layoutKey = null, activeImages = [];
  let currentImageStyle = () => 'none';
  const componentFactory = typeof module !== 'undefined' && module.exports ? require('./component-renderer.js').createComponentRenderer : createComponentRenderer;
  const components = componentFactory(stage, {imageStyle: id => currentImageStyle(id)});
  // Lazily added after the component layer: legacy-only projects keep their DOM.
  // component-layer is an isolated z-index:1 context, so even enormous instance
  // z-indices cannot escape above this independent z-index:2 overlay context.
  let performanceLayer, screenMask, titleCard, titleText;
  let videoRenderer;
  function renderVideo(state, project, resourceUrls) {
    if (!videoRenderer && !project.scene?.videoClips?.length && !state.activeVideo) return;
    if (!videoRenderer) {
      const api = typeof module !== 'undefined' && module.exports ? require('./video-renderer.js') : globalThis.VideoRenderer;
      if (!api?.createVideoRenderer) throw new Error('Video renderer unavailable');
      videoRenderer = api.createVideoRenderer(stage, {requestFrame: options.requestVideoFrame || (request => {
        if (typeof globalThis.__requestVideoFrame === 'function') return globalThis.__requestVideoFrame(request);
        if (typeof globalThis.replay?.videoFrame === 'function') return globalThis.replay.videoFrame(request);
        throw new Error('Video frame bridge unavailable');
      }), onError: options.onVideoError});
    }
    videoRenderer.renderActive(state, project, resourceUrls);
  }
  const titleLayout = typeof module !== 'undefined' && module.exports ? require('./title-layout.js') : globalThis.TitleLayout;
  function renderPerformance(performance) {
    if (!performanceLayer && !performance) return;
    if (!performanceLayer) {
      performanceLayer = document.createElement('div');
      performanceLayer.className = 'performance-layer';
      Object.assign(performanceLayer.style, {position: 'absolute', inset: '0', zIndex: '2', isolation: 'isolate', pointerEvents: 'none'});
      screenMask = document.createElement('div'); screenMask.className = 'performance-screen-mask';
      titleCard = document.createElement('div'); titleCard.className = 'performance-title-card';
      for (const node of [screenMask, titleCard]) Object.assign(node.style, {position: 'absolute', inset: '0', backgroundColor: '#000000', pointerEvents: 'none'});
      screenMask.style.zIndex = '0';
      Object.assign(titleCard.style, {zIndex: '1', display: 'grid', placeItems: 'center', opacity: '1'});
      titleText = document.createElement('div'); titleText.className = 'performance-title-text';
      titleLayout.applyTitleTextStyle(titleText);
      titleCard.appendChild(titleText);
      performanceLayer.appendChild(screenMask); performanceLayer.appendChild(titleCard);
      stage.appendChild(performanceLayer);
    }
    performanceLayer.hidden = !performance;
    performanceLayer.style.display = performance ? 'block' : 'none';
    screenMask.style.opacity = String(performance?.screenOpacity ?? 0);
    const title = performance?.title;
    titleCard.hidden = !title;
    titleCard.style.display = title ? 'grid' : 'none';
    // Fade only the letters; the title's full-screen black backing never fades.
    titleText.textContent = title ? String(title.text ?? '') : '';
    titleLayout.applyTitleTextStyle(titleText, title?.style);
    titleText.style.opacity = String(title?.opacity ?? 1);
  }
  function loadImage(url) {
    if (!images.has(url)) {
      const image = new Image();
      image.src = url;
      const decoded = image.decode().then(() => {
        // Rasterize once at intrinsic size, independent of page/compositor origin.
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        rasterUrls.set(url, canvas.toDataURL('image/png'));
      }).catch(error => {
        throw new Error(`Scene image failed to decode: ${url}: ${error.message}`);
      });
      // Preview may not await ready(), but export must observe failures.
      decoded.catch(() => {});
      images.set(url, decoded);
    }
    return images.get(url);
  }
  function render(state, project, resourceUrls = {}) {
    lastRender = [state, project, resourceUrls];
    const {width, height} = project.design;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    const urls = new Set();
    function imageStyle(resourceId) {
      const url = resourceId && resourceUrls[resourceId];
      if (!url) return 'none';
      urls.add(url);
      return `url(${JSON.stringify(rasterUrls.get(url) || url)})`;
    }
    const bg = state.background || {};
    background.style.backgroundColor = bg.color || 'transparent';
    background.style.backgroundImage = imageStyle(bg.resourceId);
    // Replace the complete evaluated list: removed/invisible characters cannot linger.
    characters.replaceChildren(...(state.characters || []).map(character => {
      const node = document.createElement('div');
      node.className = 'char';
      node.dataset.characterId = character.id;
      for (const property of ['width', 'height']) node.style[property] = `${character[property]}px`;
      node.style.left = `${character.x}px`;
      node.style.top = `${character.y}px`;
      node.style.opacity = String(character.opacity ?? 1);
      const composition = typeof describePortrait === 'function' ? describePortrait(character) : {legacy:true};
      // Color is a no-image placeholder, never a matte behind transparent artwork.
      // Include overlay-only portraits; decode errors still propagate through ready().
      const imageIds = composition.legacy ? [character.resourceId] : [composition.base, ...(composition.layers || []).map(layer => layer.resourceId)];
      const hasPortraitImage = imageIds.some(id => id && resourceUrls[id]);
      node.style.backgroundColor = hasPortraitImage ? 'transparent' : (character.color || 'transparent');
      if (!composition.legacy) {
        const view = renderPortrait(node, character, {width: Number(character.width), height: Number(character.height), imageUrl: id => { const url = resourceUrls[id]; if (url) urls.add(url); return url ? (rasterUrls.get(url) || url) : null; }});
        node.classList.add('char-composed'); node.style.backgroundImage = 'none';
      } else {
        node.style.backgroundImage = imageStyle(character.resourceId);
        node.textContent = character.resourceId ? '' : (character.name || '');
      }
      return node;
    }));
    const first = state.performance?.dialogueVisible === false ? null : (state.dialogues || [])[0];
    currentImageStyle = imageStyle;
    const componentResult = components.render(state, project);
    const {customBodyVisible, customSpeakerVisible} = componentResult;
    dialogue.hidden = !first || (customBodyVisible && customSpeakerVisible);
    body.hidden = !first || customBodyVisible;
    speaker.hidden = !first || customSpeakerVisible;
    dialogue.lang = project.locale || 'en-US';
    body.lang = dialogue.lang;
    const characterDefinitions = globalThis.CharacterDefinitions;
    if (!first) speaker.textContent = '';
    else if (typeof characterDefinitions?.getDialogueSpeakerName === 'function') {
      speaker.textContent = characterDefinitions.getDialogueSpeakerName(project, first.speakerId);
    } else {
      // Standalone consumers may omit the shared model helpers. Schema 4 identity
      // is a definition ID, never an onstage instance (even when IDs collide).
      const instance = project.schemaVersion === 4 ? null : (project.scene.characters || []).find(c => c.id === first.speakerId);
      const character = project.schemaVersion === 3 && instance && characterDefinitions?.resolveCharacter ? characterDefinitions.resolveCharacter(project, instance) : instance;
      const definition = (project.characterDefinitions || []).find(d => d.id === (project.schemaVersion === 4 ? first.speakerId : instance?.definitionId));
      const speakerName = project.schemaVersion === 4 ? (definition?.name || '') : project.schemaVersion === 3 ? (definition?.name || character?.name || '') : (character?.name || '');
      speaker.textContent = first.speakerId === 'narrator' ? '旁白' : speakerName;
    }
    const text = first ? (first.text || '') : '';
    const key = JSON.stringify([dialogue.lang, text]);
    if (layoutKey !== key) {
      revealer.prepare(text, dialogue.lang);
      layoutKey = key;
    }
    revealer.reveal(first ? first.progress : 0);
    renderPerformance(state.performance);
    renderVideo(state, project, resourceUrls);
    activeImages = [...urls].map(loadImage);
    return componentResult;
  }
  async function ready() {
    // Opaque video frames do not depend on hidden fonts or scene assets.
    while (lastRender?.[0].activeVideo) {
      const rendered = lastRender;
      // ready() decodes and installs the actual target <img>, not a preload.
      await videoRenderer.ready();
      if (lastRender !== rendered) continue;
      // Decode is not paint readiness. Flush layout and allow a compositor
      // opportunity before preview/export captures the installed frame.
      void stage.offsetHeight;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // A seek/render during either await must settle its own decode + paint.
      // Never full-render here: that can replace/cancel the video target.
      if (lastRender === rendered) return;
    }
    await Promise.all(activeImages);
    if (lastRender) render(...lastRender);
    // Force layout before fonts.ready so fonts required by this frame are requested.
    void stage.offsetHeight;
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (lastRender?.[0].performance?.title) {
      const layout = titleLayout.measureTitle(stage, titleText);
      if (!layout.fits) throw new Error(`标题溢出 (Title overflow): requires ${layout.requiredWidth}×${layout.requiredHeight}, available ${layout.availableWidth}×${layout.availableHeight}; adjust title text or style`);
    }
  }
  async function preload(project, resourceUrls = {}) {
    await Promise.all((project.resources || []).filter(r => r.kind === 'image').map(r => {
      if (!resourceUrls[r.id]) throw new Error(`Missing image URL: ${r.id}`);
      return loadImage(resourceUrls[r.id]);
    }));
    await document.fonts.ready;
  }
  return {render, ready, preload, stage, revealer, components};
}
if (typeof module !== 'undefined') module.exports = {createSceneRenderer};
